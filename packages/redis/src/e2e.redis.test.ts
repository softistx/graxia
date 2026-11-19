import { expect, test } from 'bun:test';
import { createGraxia, createSchema } from '@graxia/core';
import { describeRedis, redisUrl, uniquePrefix } from './env.test-util';
import { redisPubSub } from './pubsub';

describeRedis('graxia server on redisPubSub', () => {
	test('an SSE subscription receives an event published by another instance', async () => {
		const prefix = uniquePrefix('e2e');
		const server = redisPubSub<{ tick: [payload: number] }>({
			url: redisUrl,
			prefix,
		});
		const other = redisPubSub<{ tick: [payload: number] }>({
			url: redisUrl,
			prefix,
		});
		const schema = createSchema<{ signal: AbortSignal }>()({
			typeDefs: 'type Query { hello: String } type Subscription { tick: Int! }',
			resolvers: {
				Query: { hello: () => 'world' },
				Subscription: {
					tick: {
						subscribe: () => server.subscribe('tick'),
						resolve: (n: number) => n,
					},
				},
			},
		});
		const graxia = createGraxia({ schema, onUnexpected: false });
		const controller = new AbortController();
		const response = await graxia.fetch(
			new Request('http://x/graphql', {
				method: 'POST',
				signal: controller.signal,
				headers: {
					'content-type': 'application/json',
					accept: 'text/event-stream',
				},
				body: JSON.stringify({ query: 'subscription { tick }' }),
			}),
		);
		expect(response.status).toBe(200);
		await server.ready();
		await other.publish('tick', 42);
		const reader = response.body?.getReader();
		const decoder = new TextDecoder();
		let text = '';
		while (!text.includes('"tick":42')) {
			const chunk = await reader?.read();
			if (!chunk || chunk.done) break;
			text += decoder.decode(chunk.value);
		}
		expect(text).toContain('"tick":42');
		controller.abort();
		await graxia.dispose({ timeout: 200 });
		await Promise.all([server.dispose(), other.dispose()]);
	});
});
