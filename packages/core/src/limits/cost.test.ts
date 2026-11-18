import { describe, expect, test } from 'bun:test';
import { GraphQLSchema, parse } from 'graphql';
import { createSchema } from '../schema/create-schema';
import { createGraxia } from '../server/create-graxia';
import { computeOperationCost } from './cost';
import { costDirectives } from './directives';

const schema = createSchema()({
	typeDefs: `
		type Query {
			users(first: Int, page: Page): [User!]!
			sized: [User!]! @listSize(assumedSize: 3)
			heavy: String @cost(weight: 50)
			sliced(first: Int, last: Int): [User!]! @listSize(slicingArguments: ["first", "last"])
			paged(page: Page): [User!]! @listSize(slicingArguments: ["page.size"])
			conn(first: Int): Conn @listSize(slicingArguments: ["first"], sizedFields: ["edges"])
			plain: String
			weighted: Weighted
		}
		type Weighted @cost(weight: 7) { id: ID }
		input Page { size: Int }
		type User { id: ID name: String posts: [Post!]! }
		type Post { id: ID }
		type Conn { edges: [Edge!]! total: Int }
		type Edge { node: User }
		scalar Big @cost(weight: 4)
	`,
	resolvers: { Query: { plain: () => 'x' } },
});

const cost = (
	query: string,
	variables?: Record<string, unknown>,
	options?: Parameters<typeof computeOperationCost>[0]['options'],
) =>
	computeOperationCost({
		schema,
		document: parse(query),
		...(variables ? { variables } : {}),
		...(options ? { options } : {}),
	});

describe('computeOperationCost', () => {
	test('scalars cost scalarCost, objects objectCost', () => {
		expect(cost('{ plain }')).toBe(0);
		expect(cost('{ plain }', undefined, { scalarCost: 2 })).toBe(2);
		expect(cost('{ weighted { id } }')).toBe(7);
	});
	test('@cost on a field adds once', () => {
		expect(cost('{ heavy }')).toBe(50);
	});
	test('defaultListSize multiplies the item cost', () => {
		expect(cost('{ users { id } }')).toBe(10);
		expect(cost('{ users { id } }', undefined, { defaultListSize: 4 })).toBe(4);
		expect(cost('{ users { posts { id } } }')).toBe(10 * (1 + 10 * 1));
	});
	test('assumedSize', () => {
		expect(cost('{ sized { id } }')).toBe(3);
	});
	test('a literal slicing argument', () => {
		expect(cost('{ users { id } }')).toBe(10);
		expect(cost('{ sliced(first: 2) { id } }')).toBe(2);
		expect(cost('{ sliced(first: 2, last: 5) { id } }')).toBe(5);
		expect(cost('{ paged(page: { size: 6 }) { id } }')).toBe(6);
	});
	test('a slicing argument read from a variable', () => {
		expect(
			cost('query($n: Int) { sliced(first: $n) { id } }', { n: 400 }),
		).toBe(400);
		expect(cost('query($n: Int = 7) { sliced(first: $n) { id } }')).toBe(7);
	});
	test('sizedFields apply the size to the listed child', () => {
		expect(cost('{ conn(first: 5) { edges { node { id } } total } }')).toBe(
			1 + 5 * (1 + 1),
		);
	});
	test('fragments, inline fragments and introspection', () => {
		expect(
			cost(
				'{ ...F ... on Query { sized { id } } } fragment F on Query { heavy }',
			),
		).toBe(53);
		expect(cost('{ __schema { types { name } } __typename }')).toBe(0);
	});
	test('a fragment cycle terminates', () => {
		expect(
			cost(
				'{ users { ...A } } fragment A on User { posts { ...B } } fragment B on Post { ...A }',
			),
		).toBeGreaterThan(0);
	});
	test('the exported directives work on a schema built in code', () => {
		const plain = new GraphQLSchema({
			...schema.toConfig(),
			directives: [
				...schema.getDirectives(),
				...costDirectives.filter((d) => !schema.getDirective(d.name)),
			],
		});
		expect(
			computeOperationCost({ schema: plain, document: parse('{ heavy }') }),
		).toBe(50);
	});
	test('createSchema adds the directives unless declared', () => {
		expect(schema.getDirective('cost')).toBeDefined();
		expect(schema.getDirective('listSize')).toBeDefined();
		const own = createSchema()({
			typeDefs:
				'directive @cost(weight: Int!) on FIELD_DEFINITION type Query { a: Int @cost(weight: 2) }',
		});
		expect(own.getDirective('listSize')).toBeDefined();
	});
});

async function post(
	query: string,
	variables?: object,
	limits = { cost: { max: 100 } },
) {
	const graxia = createGraxia({ schema, limits, onUnexpected: false });
	const response = await graxia.fetch(
		new Request('http://x/graphql', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				accept: 'application/graphql-response+json',
			},
			body: JSON.stringify({ query, variables }),
		}),
	);
	await graxia.dispose({ timeout: 10 });
	return { status: response.status, body: (await response.json()) as any };
}

describe('limits.cost', () => {
	test('refuses an operation over the maximum with the limit shape', async () => {
		const { status, body } = await post('{ sliced(first: 500) { id } }');
		expect(status).toBe(400);
		expect(body.errors[0].message).toBe(
			'Operation cost 500 exceeds the limit of 100.',
		);
		expect(body.errors[0].extensions).toEqual({
			code: 'GRAPHQL_VALIDATION_FAILED',
			limit: { name: 'cost', max: 100, actual: 500 },
			fix: 'Request fewer items (use the slicing arguments, such as first) or raise limits.cost.max.',
		});
	});
	test('a variable cannot bypass it', async () => {
		const q = 'query($n: Int) { sliced(first: $n) { id } }';
		expect((await post(q, { n: 500 })).status).toBe(400);
		expect((await post(q, { n: 100 })).status).toBe(200);
	});
	test('at the maximum passes; false turns it off', async () => {
		expect((await post('{ sliced(first: 100) { id } }')).status).toBe(200);
		expect(
			(
				await post('{ sliced(first: 500) { id } }', undefined, {
					cost: false,
				} as never)
			).status,
		).toBe(200);
	});
	test('graxia.execute is refused too', async () => {
		const graxia = createGraxia({
			schema,
			limits: { cost: { max: 100 } },
			onUnexpected: false,
		});
		const result = await graxia.execute({
			document: '{ sliced(first: 500) { id } }',
		});
		expect(result.errors?.[0]?.message).toBe(
			'Operation cost 500 exceeds the limit of 100.',
		);
		await graxia.dispose({ timeout: 10 });
	});
});
