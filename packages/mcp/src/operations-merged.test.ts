import { afterAll, describe, expect, test } from 'bun:test';
import {
	Client,
	StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { fromJsonSchema } from '@modelcontextprotocol/server';
import { createGraxia, createSchema } from '@softistx/graxia';
import { call, rpc } from './fixtures.test-util';
import { createMcp } from './index';
import { listed } from './operations.test-util';

const author = { name: 'Frank', age: 65, email: 'f@x.io' };
const items: Record<string, object> = {
	b: { __typename: 'Book', id: 'b', author },
	m: { __typename: 'Mag', id: 'm', author },
};
const schema = createSchema()({
	typeDefs: /* GraphQL */ `
		type Author { name: String! age: Int! email: String! }
		interface Node { id: ID! }
		type Book implements Node { id: ID! author: Author! }
		type Mag implements Node { id: ID! author: Author! }
		union Hit = Book | Mag
		type Query { node(id: ID!): Node book: Book! hits: [Hit!]! }
	`,
	resolvers: {
		Query: {
			node: (_: unknown, a: Record<string, unknown>) =>
				items[a['id'] as string],
			book: () => items['b'],
			hits: () => Object.values(items),
		},
	},
});
const mcp = createMcp(createGraxia({ schema }), {
	name: 'merged',
	operations: {
		documents: {
			a: '"""A node.""" query A($id: ID!) { node(id: $id) { ... on Book { author { name } } ... on Mag { author { age } } } }',
			b: '"""A book.""" query B($x: Boolean!) { book { author { name } author @include(if: $x) { email } } }',
			c: '"""Hits.""" query C { hits { ... on Book { a: author { name } } ... on Mag { a: author { age } } } }',
			d: '"""Both.""" query D($id: ID!) { node(id: $id) { ... on Book { author { name } } ... on Mag { author { name age } } } }',
		},
	},
});
const server = Bun.serve({ port: 0, fetch: (req) => mcp.fetch(req) });
afterAll(async () => {
	await server.stop(true);
	await mcp.dispose();
});

const outputOf = async (name: string) =>
	(await listed(mcp, rpc('tools/list'))).find((t) => t.name === name)
		.outputSchema;

describe('one response key selected by several field nodes', () => {
	test.each([
		['a', { id: 'b' }, { node: { author: { name: 'Frank' } } }],
		['a', { id: 'm' }, { node: { author: { age: 65 } } }],
		['a', { id: 'none' }, { node: null }],
		['b', { x: false }, { book: { author: { name: 'Frank' } } }],
		[
			'b',
			{ x: true },
			{ book: { author: { name: 'Frank', email: 'f@x.io' } } },
		],
		['c', {}, { hits: [{ a: { name: 'Frank' } }, { a: { age: 65 } }] }],
	] as const)('%s %j: the real result validates', async (name, args, data) => {
		const r = await call(mcp, name, args);
		expect(r.result.structuredContent).toEqual({ data });
		const checked = await fromJsonSchema(await outputOf(name))[
			'~standard'
		].validate(r.result.structuredContent);
		expect(checked.issues).toBeUndefined();
	});
	test('a key every node selects, or a sure node selects, stays required', async () => {
		const d = (await outputOf('d')).properties.data.properties.node.properties
			.author;
		expect(d.required).toEqual(['name']);
		const b = (await outputOf('b')).properties.data.properties.book;
		expect(b.required).toEqual(['author']);
		expect(b.properties.author.required).toEqual(['name']);
		const a = (await outputOf('a')).properties.data.properties.node.properties
			.author;
		expect(a.required).toBeUndefined();
	});
	test('a real client accepts the result of each concrete type', async () => {
		const client = new Client({ name: 'test', version: '0.0.0' });
		await client.connect(
			new StreamableHTTPClientTransport(
				new URL(`http://localhost:${server.port}/mcp`),
			),
		);
		await client.listTools();
		for (const [id, expected] of [
			['b', { name: 'Frank' }],
			['m', { age: 65 }],
		] as const) {
			const result = await client.callTool({ name: 'a', arguments: { id } });
			expect(result.isError).toBeFalsy();
			expect(result.structuredContent).toEqual({
				data: { node: { author: expected } },
			});
		}
		await client.close();
	});
});
