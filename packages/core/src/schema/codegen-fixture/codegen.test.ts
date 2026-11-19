import { describe, expect, test } from 'bun:test';
import { createGraxia } from '../../server/create-graxia';
import { createSchema } from '../create-schema';
import { context, type FixtureContext } from './context';
import type { Resolvers } from './generated';
import { resolvers } from './resolvers';

const typeDefs = await Bun.file(
	new URL('./schema.graphql', import.meta.url),
).text();
const schema = createSchema<FixtureContext, Resolvers>()({
	typeDefs,
	resolvers,
});
const graxia = createGraxia({ schema, context, onUnexpected: false });

const post = (body: object, accept = 'application/json') =>
	graxia.fetch(
		new Request('http://x/graphql', {
			method: 'POST',
			headers: { 'content-type': 'application/json', accept, 'x-user': '1' },
			body: JSON.stringify(body),
		}),
	);

describe('a graxia instance on graphql-codegen resolvers', () => {
	test('queries: mapper, enum internal values, scalar, interface, union', async () => {
		const response = await post({
			query: `{
				me { id name role joined }
				today
				node(id: "1") { __typename id }
				search(term: "t") { __typename ... on Post { title } ... on User { name } }
			}`,
		});
		expect(await response.json()).toEqual({
			data: {
				me: { id: '1', name: 'Ada', role: 'ADMIN', joined: 0 },
				today: 0,
				node: { __typename: 'User', id: '1' },
				search: [
					{ __typename: 'User', name: 'Ada' },
					{ __typename: 'Post', title: 't' },
				],
			},
		});
	});

	test('a mutation', async () => {
		const response = await post({
			query:
				'mutation { addPost(input: { title: "hi" }) { title author { name } } }',
		});
		expect(await response.json()).toEqual({
			data: { addPost: { title: 'hi', author: { name: 'Ada' } } },
		});
	});

	test('subscriptions with and without resolve, over SSE', async () => {
		const sse = 'text/event-stream';
		const clock = await (
			await post({ query: 'subscription { clock }' }, sse)
		).text();
		expect(clock).toContain('data: {"data":{"clock":1}}');
		expect(clock).toContain('data: {"data":{"clock":2}}');
		const added = await (
			await post({ query: 'subscription { postAdded { title } }' }, sse)
		).text();
		expect(added).toContain('data: {"data":{"postAdded":{"title":"1"}}}');
	});
});
