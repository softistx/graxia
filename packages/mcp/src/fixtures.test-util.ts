import { createGraxia, createSchema } from '@graxia/core';
import { createMcp, type McpOptions } from './index';

export const typeDefs = /* GraphQL */ `
	directive @needs(permission: String, anyOf: [String!]) repeatable on OBJECT | FIELD_DEFINITION
	"""A book in the library."""
	type Book {
		id: ID!
		"""The title."""
		title: String!
		secretNote: String @needs(permission: "staff")
	}
	type Query {
		"""Find a book by id."""
		book(id: ID!): Book
		"""All books."""
		books: [Book!]!
		boom: String
		staffReport: String @needs(permission: "staff")
	}
	type Mutation {
		"""Rename a book."""
		rename(id: ID!, title: String!): Book
	}
	type Subscription {
		ticks: Int
	}
`;

const books = [{ id: '1', title: 'Dune', secretNote: 'hidden' }];

export function app(options: Record<string, unknown> = {}) {
	const schema = createSchema()({
		typeDefs,
		resolvers: {
			Query: {
				book: (_: unknown, a: Record<string, unknown>) =>
					books.find((b) => b.id === a['id']),
				books: () => books,
				boom: () => {
					throw new Error('db password leaked');
				},
				staffReport: () => 'report',
			},
			Mutation: {
				rename: (_: unknown, a: Record<string, unknown>) => ({
					...(books[0] as object),
					id: a['id'],
					title: a['title'],
				}),
			},
			Subscription: {
				ticks: {
					subscribe: async function* () {
						yield { ticks: 1 };
					},
				},
			},
		},
	});
	const graxia = createGraxia({ schema, ...options });
	return { schema, graxia };
}

export function mcpFor(
	extra: Partial<McpOptions> = {},
	graxiaOptions: Record<string, unknown> = {},
) {
	const { schema, graxia } = app(graxiaOptions);
	const mcp = createMcp(graxia, { schema, name: 'library', ...extra });
	return { mcp, graxia, schema };
}

const headers = {
	'content-type': 'application/json',
	accept: 'application/json, text/event-stream',
};

export const rpc = (
	method: string,
	params: unknown = {},
	extra: HeadersInit = {},
	id = 1,
) =>
	new Request('http://localhost/mcp', {
		method: 'POST',
		headers: { ...headers, ...extra },
		body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
	});

/** `tools/call` over the legacy stateless leg (a plain POST with no protocol envelope). */
export async function call(
	mcp: { fetch(r: Request): Promise<Response> },
	name: string,
	args: unknown,
	extra: HeadersInit = {},
) {
	const response = await mcp.fetch(
		rpc('tools/call', { name, arguments: args }, extra),
	);
	const text = await response.text();
	const body = JSON.parse(
		text.startsWith('event:') || text.startsWith('data:')
			? (text.split('\n').find((l) => l.startsWith('data:')) ?? '').slice(5)
			: text,
	);
	return { response, body, result: body.result };
}
