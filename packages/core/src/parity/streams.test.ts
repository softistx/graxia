import { afterEach, describe, expect, test } from 'bun:test';
import { createSchema } from '../schema/create-schema';
import { resolveStreaming } from '../server/streaming-options';
import { raw, sleep, start as startOne, until } from '../ws/ws.test-util';

const started: ReturnType<typeof startOne>[] = [];
/** `start` from the ws helpers, remembering every instance so each is disposed. */
const start: typeof startOne = (options) => {
	const one = startOne(options);
	started.push(one);
	return one;
};
afterEach(async () => {
	for (const one of started.splice(0))
		await one.graxia.dispose({ timeout: 100 });
});

let signals: AbortSignal[] = [];

const schema = createSchema<{ signal: AbortSignal }>()({
	typeDefs: `
		type Query { hello: String }
		type Subscription { ticks: Int! }
	`,
	resolvers: {
		Query: { hello: () => 'world' },
		Subscription: {
			ticks: {
				subscribe: async function* (_: unknown, __: unknown, { signal }) {
					signals.push(signal);
					yield 1;
					await new Promise((resolve) =>
						signal.addEventListener('abort', resolve, { once: true }),
					);
				},
				resolve: (n: number) => n,
			},
		},
	},
});

describe('keep-alive', () => {
	test('SSE and WebSocket keep-alive default to 12 000 ms', () => {
		const resolved = resolveStreaming({ schema });
		expect(resolved.keepAliveMs).toBe(12_000);
		expect(resolved.ws && resolved.ws.keepAliveMs).toBe(12_000);
	});

	test('keepAliveMs: 0 sends no ping', async () => {
		const quiet = start({
			schema,
			subscriptions: { ws: { keepAliveMs: 0 } },
		});
		const off = raw(quiet.url);
		await off.init();
		const received: unknown[] = [];
		off.socket.addEventListener('message', (e) => received.push(e.data));
		await sleep(150);
		expect(received).toEqual([]);
		await quiet.graxia.dispose({ timeout: 100 });
		// the control: the same wait with pings on does see one
		const loud = start({
			schema,
			subscriptions: { ws: { keepAliveMs: 20 } },
		});
		const on = raw(loud.url);
		await on.init();
		expect(await on.next()).toEqual({ type: 'ping' });
	});
});

describe('the operation signal', () => {
	test("a subscription resolver's signal aborts when the client leaves (SSE and WebSocket)", async () => {
		signals = [];
		const { url, server } = start({ schema });
		const socket = raw(url);
		await socket.init();
		await socket.send({
			id: '1',
			type: 'subscribe',
			payload: { query: 'subscription { ticks }' },
		});
		expect((await socket.next()).type).toBe('next');
		expect(signals).toHaveLength(1);
		expect(signals[0]?.aborted).toBe(false);
		await socket.send({ id: '1', type: 'complete' });
		await until(() => signals[0]?.aborted === true, 1000);
		expect(signals[0]?.aborted).toBe(true);

		const controller = new AbortController();
		const response = await fetch(`http://localhost:${server.port}/graphql`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				accept: 'text/event-stream',
			},
			body: JSON.stringify({ query: 'subscription { ticks }' }),
			signal: controller.signal,
		});
		const reader = response.body?.getReader();
		await reader?.read();
		expect(signals).toHaveLength(2);
		expect(signals[1]?.aborted).toBe(false);
		controller.abort();
		await until(() => signals[1]?.aborted === true, 1000);
		expect(signals[1]?.aborted).toBe(true);
	});
});
