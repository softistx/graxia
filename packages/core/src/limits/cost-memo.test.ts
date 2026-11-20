import { describe, expect, test } from 'bun:test';
import { createSchema } from '../schema/create-schema';
import { createGraxia } from '../server/create-graxia';

const schema = createSchema()({
	typeDefs: `
		type Query {
			plain: String
			users(first: Int): [User!]! @listSize(slicingArguments: ["first"])
		}
		type User { id: ID }
	`,
	resolvers: { Query: { plain: () => 'x', users: () => [] } },
});

const instance = (max: number) =>
	createGraxia({ schema, limits: { cost: { max } }, onUnexpected: false });
const ask = async (
	g: ReturnType<typeof instance>,
	query: string,
	variables?: Record<string, unknown>,
) => {
	const res = await g.fetch(
		new Request('http://x/graphql', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				accept: 'application/graphql-response+json',
			},
			body: JSON.stringify({ query, variables }),
		}),
	);
	return { status: res.status, body: (await res.json()) as any };
};

describe('cost check of a repeated document', () => {
	test('a passing document passes every time', async () => {
		const g = instance(5);
		for (const _ of [1, 2, 3])
			expect((await ask(g, '{ plain }')).status).toBe(200);
	});
	test('an over-cost document is refused on the first and the second request', async () => {
		const g = instance(5);
		const query = '{ users(first: 10) { id } }';
		for (const _ of [1, 2]) {
			const { status, body } = await ask(g, query);
			expect(status).toBe(400);
			expect(body.errors[0].extensions.limit).toEqual({
				name: 'cost',
				max: 5,
				actual: 10,
			});
		}
	});
	test('a document with variables is judged on each request', async () => {
		const g = instance(50);
		const query = 'query ($n: Int) { users(first: $n) { id } }';
		expect((await ask(g, query, { n: 1 })).status).toBe(200);
		expect((await ask(g, query, { n: 100000 })).status).toBe(400);
		expect((await ask(g, query, { n: 2 })).status).toBe(200);
		expect((await ask(g, query, { n: 100000 })).status).toBe(400);
	});
	test('two instances with different limits answer differently for one text', async () => {
		const small = instance(5);
		const large = instance(50);
		const query = '{ users(first: 10) { id } }';
		for (const _ of [1, 2]) {
			expect((await ask(small, query)).status).toBe(400);
			expect((await ask(large, query)).status).toBe(200);
		}
	});
	test('a missing slicing argument is refused every time', async () => {
		const g = instance(50);
		for (const _ of [1, 2])
			expect((await ask(g, '{ users { id } }')).status).toBe(400);
	});
});
