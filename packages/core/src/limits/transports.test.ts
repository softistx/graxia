import { describe, expect, test } from 'bun:test';
import { createSchema } from '../schema/create-schema';
import { createGraxia } from '../server/create-graxia';
import { raw, start } from '../ws/ws.test-util';

const schema = createSchema()({
	typeDefs: `type Query { items(first: Int): [Item!]! @listSize(slicingArguments: ["first"]) } type Item { id: Int }`,
	resolvers: { Query: { items: () => [] } },
});
const limits = { cost: { max: 5 } };
const query = '{ items(first: 50) { id } }';

describe('limits over every transport', () => {
	test('server-sent events: next with the errors, then complete', async () => {
		const graxia = createGraxia({ schema, limits, onUnexpected: false });
		const response = await graxia.fetch(
			new Request('http://x/graphql', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					accept: 'text/event-stream',
				},
				body: JSON.stringify({ query }),
			}),
		);
		const text = await response.text();
		expect(text).toContain('Operation cost 50 exceeds the limit of 5.');
		expect(text).toContain('"limit":{"name":"cost","max":5,"actual":50}');
		await graxia.dispose({ timeout: 10 });
	});

	test('WebSocket: an error message', async () => {
		const { url } = start({ schema, limits });
		const client = raw(url);
		await client.init();
		await client.send({
			id: '1',
			type: 'subscribe',
			payload: { query },
		});
		const message = await client.next();
		expect(message.type).toBe('error');
		expect(message.payload[0].extensions.limit).toEqual({
			name: 'cost',
			max: 5,
			actual: 50,
		});
	});

	test('a validation limit over WebSocket', async () => {
		const { url } = start({ schema, limits: { rootFields: 1 } });
		const client = raw(url);
		await client.init();
		await client.send({
			id: '1',
			type: 'subscribe',
			payload: {
				query: '{ a: items(first: 1) { id } b: items(first: 1) { id } }',
			},
		});
		const message = await client.next();
		expect(message.type).toBe('error');
		expect(message.payload[0].extensions.limit.name).toBe('rootFields');
	});
});
