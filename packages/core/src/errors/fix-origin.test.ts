import { describe, expect, test } from 'bun:test';
import {
	type ExecutionResult,
	experimentalExecuteIncrementally,
	GraphQLError,
	parse,
	subscribe,
	type ValidationRule,
} from 'graphql';
import { checkDocument } from '../document/validate';
import { createSchema } from '../schema/create-schema';
import { createGraxia } from '../server/create-graxia';
import { exposedError } from './exposed';
import {
	GRAPHQL_FIX,
	INTERNAL_FIX,
	NON_NULL_FIX,
	stampRaisedByGraphql,
	VALIDATION_FIX,
} from './fixes';
import { defaultMask, maskResult } from './mask';

/**
 * Who writes the `fix`: graxia stamps the errors graphql raises before a field
 * runs, gives a null in a non-null field its own, and never adds one to an error
 * a resolver or a `subscribe` threw.
 */
const schema = createSchema()({
	typeDefs: `
		type Query { n(x: Int!): Int must: String! mine: String own: String }
		type Subscription { s: Int }
	`,
	resolvers: {
		Query: {
			must: () => null as unknown as string,
			mine: () => {
				throw new GraphQLError('Mine.');
			},
			own: () => {
				throw exposedError('NOT_FOUND', 'No such thing.');
			},
		},
		Subscription: {
			s: {
				subscribe: () => {
					throw new GraphQLError('Not allowed to subscribe.');
				},
				resolve: () => 1,
			},
		},
	},
});
const execute = (
	args: Parameters<typeof experimentalExecuteIncrementally>[0],
) => experimentalExecuteIncrementally(args) as Promise<ExecutionResult>;
const mask = (result: ExecutionResult) =>
	maskResult(result, defaultMask, { correlationId: 'id' }, schema).result;
const extensionsOf = (result: ExecutionResult) =>
	result.errors?.[0]?.extensions;

describe('the fix of an error graphql raised', () => {
	test('a missing variable gets the graphql fix once stamped', async () => {
		const raw = await execute({
			schema,
			document: parse('query($x: Int!) { n(x: $x) }'),
		});
		expect(extensionsOf(raw)?.['fix']).toBeUndefined();
		expect(extensionsOf(mask(stampRaisedByGraphql(raw)))?.['fix']).toBe(
			GRAPHQL_FIX,
		);
	});

	test('a subscribe that throws keeps its own error, with no fix', async () => {
		const raw = (await subscribe({
			schema,
			document: parse('subscription { s }'),
		})) as ExecutionResult;
		expect(raw.errors?.[0]?.path).toEqual(['s']);
		const out = mask(stampRaisedByGraphql(raw));
		expect(out.errors?.[0]?.message).toBe('Not allowed to subscribe.');
		expect(extensionsOf(out)?.['fix']).toBeUndefined();
	});

	test('an error in the completed list of a deferred payload keeps no fix', () => {
		const payload = {
			completed: [
				{
					id: '0',
					errors: [new GraphQLError('Gone.', { path: ['a', 'b'] })],
				},
			],
		} as unknown as ExecutionResult;
		const entry = (payload as unknown as { completed: ExecutionResult[] })
			.completed[0] as ExecutionResult;
		expect(extensionsOf(mask(entry))?.['fix']).toBeUndefined();
	});
});

describe('the fix of an error a resolver threw', () => {
	test('a GraphQLError and an exposedError without a fix get none', async () => {
		const out = mask(
			await execute({ schema, document: parse('{ mine own }') }),
		);
		expect(out.errors?.map((e) => e.extensions['fix'])).toEqual([
			undefined,
			undefined,
		]);
		expect(out.errors?.[1]?.extensions['code']).toBe('NOT_FOUND');
	});

	test('a null in a non-null field has its own fix', async () => {
		const out = mask(await execute({ schema, document: parse('{ must }') }));
		expect(extensionsOf(out)?.['fix']).toBe(NON_NULL_FIX);
	});
});

describe('the masked error and the validation rules', () => {
	const failing = createSchema()({
		typeDefs: 'type Query { boom: String }',
		resolvers: {
			Query: {
				boom: () => {
					throw new Error('secret detail about the database');
				},
			},
		},
	});
	test.each(['development', 'production'])(
		'a masked error carries exactly INTERNAL_FIX, and no cause text (%s)',
		async (env) => {
			const graxia = createGraxia({
				schema: failing,
				onUnexpected: false,
				...(env === 'production' ? { mode: 'production' } : {}),
			} as Parameters<typeof createGraxia>[0]);
			const response = await graxia.fetch(
				new Request('http://x/graphql', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ query: '{ boom }' }),
				}),
			);
			const text = await response.text();
			await graxia.dispose({ timeout: 10 });
			const body = JSON.parse(text);
			expect(body.errors[0].extensions.fix).toBe(INTERNAL_FIX);
			expect(body.errors[0].message).toBe('Unexpected error.');
			expect(text).not.toContain('secret detail');
			expect(text).not.toContain('database');
		},
	);

	test('a custom rule keeps its own code and extensions; the fix is added to the same error', () => {
		const rule: ValidationRule = (context) => ({
			Field(node) {
				context.reportError(
					new GraphQLError('No fields today.', {
						nodes: node,
						extensions: { code: 'CLOSED', hours: 3 },
					}),
				);
			},
		});
		const [error] = checkDocument(
			{
				schema: failing,
				rules: [rule],
				hideSuggestions: false,
				validationCache: undefined,
			},
			parse('{ boom }'),
			undefined,
			undefined,
			[],
		);
		expect(error?.constructor).toBe(GraphQLError);
		expect(error?.extensions).toEqual({
			code: 'CLOSED',
			hours: 3,
			fix: VALIDATION_FIX,
		});
		const [own] = checkDocument(
			{
				...{
					schema: failing,
					hideSuggestions: false,
					validationCache: undefined,
				},
				rules: [],
			},
			parse('{ nope }'),
			undefined,
			undefined,
			[],
		);
		expect(own?.extensions).toMatchObject({
			code: 'GRAPHQL_VALIDATION_FAILED',
			fix: VALIDATION_FIX,
		});
	});
});
