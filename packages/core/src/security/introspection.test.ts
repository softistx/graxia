import { afterEach, describe, expect, test } from 'bun:test';
import { createSchema } from '../schema/create-schema';
import { createGraxia } from '../server/create-graxia';
import { schema } from '../server/fixtures.test-util';

const original = process.env['NODE_ENV'];
afterEach(() => {
	if (original === undefined) delete process.env['NODE_ENV'];
	else process.env['NODE_ENV'] = original;
});

const messages = (result: { errors?: readonly { message: string }[] }) =>
	(result.errors ?? []).map((e) => e.message);

describe('introspection', () => {
	test('false refuses __schema and __type, not __typename', async () => {
		const graxia = createGraxia({ schema, introspection: false });
		for (const document of [
			'{ __schema { queryType { name } } }',
			'{ __type(name: "Query") { name } }',
		]) {
			const result = await graxia.execute({ document });
			expect(messages(result)[0]).toContain('introspection is not allowed');
			expect(result.errors?.[0]?.extensions?.['code']).toBe(
				'GRAPHQL_VALIDATION_FAILED',
			);
			expect(String(result.errors?.[0]?.extensions?.['fix'])).toContain(
				'introspection: true',
			);
		}
		const ok = await graxia.execute({ document: '{ __typename hello }' });
		expect(ok.data).toEqual({ __typename: 'Query', hello: 'world' });
	});

	test('it is refused over HTTP too, repeatedly (cached)', async () => {
		const graxia = createGraxia({ schema, introspection: false });
		for (let i = 0; i < 2; i++) {
			const response = await graxia.fetch(
				new Request('http://localhost/graphql', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({
						query: '{ __schema { queryType { name } } }',
					}),
				}),
			);
			expect(JSON.stringify(await response.json())).toContain(
				'introspection is not allowed',
			);
		}
	});

	test('true allows it, and the default follows NODE_ENV', async () => {
		const query = '{ __schema { queryType { name } } }';
		const on = await createGraxia({ schema, introspection: true }).execute({
			document: query,
		});
		expect(on.errors).toBeUndefined();
		process.env['NODE_ENV'] = 'production';
		const prod = createGraxia({ schema });
		expect(messages(await prod.execute({ document: query }))).toHaveLength(1);
		const forced = createGraxia({ schema, introspection: true });
		expect((await forced.execute({ document: query })).errors).toBeUndefined();
		process.env['NODE_ENV'] = 'development';
		const dev = createGraxia({ schema });
		expect((await dev.execute({ document: query })).errors).toBeUndefined();
	});
});

const colors = createSchema()({
	typeDefs: `
		enum Color { RED GREEN }
		type Query { paint(c: Color): String }
	`,
	resolvers: { Query: { paint: () => 'x' } },
});

describe('suggestions', () => {
	const run = async (suggestions: boolean | undefined) => {
		const graxia = createGraxia({
			schema: colors,
			...(suggestions === undefined ? {} : { suggestions }),
		});
		const validation = await graxia.execute({ document: '{ pain }' });
		const coercion = await graxia.execute({
			document: 'query ($c: Color) { paint(c: $c) }',
			variables: { c: 'REDD' },
		});
		return [...messages(validation), ...messages(coercion)].join('\n');
	};

	test('shown by default outside production', async () => {
		const text = await run(undefined);
		expect(text).toContain('Did you mean "paint"');
		expect(text).toContain('Did you mean the enum value "RED"');
	});

	test('false removes them from validation and variable coercion errors', async () => {
		const text = await run(false);
		expect(text).toContain('Cannot query field "pain"');
		expect(text).toContain('does not exist in "Color" enum');
		expect(text).not.toContain('Did you mean');
	});

	test('the default is off under NODE_ENV=production', async () => {
		process.env['NODE_ENV'] = 'production';
		expect(await run(undefined)).not.toContain('Did you mean');
		expect(await run(true)).toContain('Did you mean');
	});
});
