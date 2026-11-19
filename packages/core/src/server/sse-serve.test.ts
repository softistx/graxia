import { describe, expect, test } from 'bun:test';
import { createPubSub } from '../pubsub/memory';
import { createSchema } from '../schema/create-schema';
import { createGraxia } from './create-graxia';

describe('SSE on a real Bun server', () => {
	test('a stream outlives the server idleTimeout', async () => {
		const pubsub = createPubSub<{ tick: [payload: number] }>();
		const schema = createSchema<{ signal: AbortSignal }>()({
			typeDefs: 'type Query { _: Int } type Subscription { tick: Int! }',
			resolvers: {
				Subscription: {
					tick: {
						subscribe: () => pubsub.subscribe('tick'),
						resolve: (n: number) => n,
					},
				},
			},
		});
		const graxia = createGraxia({
			schema,
			subscriptions: { sse: { keepAliveMs: 10_000 } },
		});
		const server = graxia.serve({ port: 0, idleTimeout: 1 });
		try {
			const response = await fetch(`http://localhost:${server.port}/graphql`, {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					accept: 'text/event-stream',
				},
				body: JSON.stringify({ query: 'subscription { tick }' }),
			});
			expect(response.headers.get('content-type')).toContain(
				'text/event-stream',
			);
			await new Promise((r) => setTimeout(r, 2500));
			await pubsub.publish('tick', 42);
			const reader = (response.body as ReadableStream<Uint8Array>).getReader();
			const decoder = new TextDecoder();
			let text = '';
			while (!text.includes('"tick":42')) {
				const { value, done } = await reader.read();
				if (done) break;
				text += decoder.decode(value);
			}
			expect(text).toContain('"tick":42');
			await reader.cancel();
		} finally {
			await graxia.dispose({ timeout: 200 });
		}
	}, 10_000);
});
