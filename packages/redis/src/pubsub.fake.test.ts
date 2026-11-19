import { describe, expect, test } from 'bun:test';
import { createGraxia, createSchema, GraxiaConfigError } from '@graxia/core';
import type { RedisClient } from 'bun';
import { until } from './env.test-util';
import { redisPubSub } from './pubsub';

type Listener = (message: string, channel: string) => void;

/** A stand-in for the publisher client and its duplicate (the subscriber). */
function fakeRedis() {
	const calls: string[] = [];
	const listeners = new Map<string, Listener[]>();
	const subscriber = {
		onconnect: null as (() => void) | null,
		onclose: null as ((error: Error) => void) | null,
		connected: true,
		connect: async () => {},
		subscribe: async (channel: string, listener: Listener) => {
			calls.push(`subscribe ${channel}`);
			listeners.set(channel, [...(listeners.get(channel) ?? []), listener]);
			return 1;
		},
		unsubscribe: async (channel: string, listener?: Listener) => {
			calls.push(`unsubscribe ${channel}`);
			const left = listener
				? (listeners.get(channel) ?? []).filter((l) => l !== listener)
				: [];
			if (left.length > 0) listeners.set(channel, left);
			else listeners.delete(channel);
		},
		close: () => calls.push('subscriber closed'),
	};
	const client = {
		duplicate: async () => subscriber,
		publish: async (channel: string, message: string) => {
			for (const listener of listeners.get(channel) ?? [])
				listener(message, channel);
			return 1;
		},
		close: () => calls.push('client closed'),
	};
	return {
		calls,
		listeners,
		subscriber,
		client: client as unknown as RedisClient,
	};
}

describe('redisPubSub (fake client)', () => {
	test('url and client together is a config error', () => {
		expect(() =>
			redisPubSub({ url: 'redis://x', client: {} } as never),
		).toThrow(GraxiaConfigError);
		expect(() =>
			redisPubSub({ url: 'redis://x', client: {} } as never),
		).toThrow('@graxia/redis: pass either "url" or "client", not both');
	});

	test('one SUBSCRIBE per topic, shared; UNSUBSCRIBE when the last leaves', async () => {
		const { calls, client } = fakeRedis();
		const pubsub = redisPubSub<{ t: [payload: number] }>({
			client,
			prefix: 'p:',
		});
		const a = pubsub.subscribe('t');
		const b = pubsub.subscribe('t');
		await pubsub.ready();
		expect(calls).toEqual(['subscribe p:t']);
		await pubsub.publish('t', 7);
		expect((await a.next()).value).toBe(7);
		expect((await b.next()).value).toBe(7);
		await a.return?.();
		await pubsub.ready();
		expect(calls).toEqual(['subscribe p:t']);
		await b.return?.();
		await until(() => calls.includes('unsubscribe p:t'));
		expect(pubsub.subscriberCount('t')).toBe(0);
	});

	test('return() releases the topic and a later subscribe registers again', async () => {
		const { calls, client } = fakeRedis();
		const pubsub = redisPubSub<{ t: [payload: number] }>({ client });
		const events = pubsub.subscribe('t');
		await pubsub.ready();
		await events.return?.();
		expect((await events.next()).done).toBe(true);
		await until(() => calls.includes('unsubscribe graxia:t'));
		pubsub.subscribe('t');
		await pubsub.ready();
		expect(calls.filter((c) => c.startsWith('subscribe'))).toHaveLength(2);
	});

	test('an id is its own channel: topic:id', async () => {
		const { calls, client } = fakeRedis();
		const pubsub = redisPubSub<{ post: [id: string, payload: number] }>({
			client,
			prefix: 'p:',
		});
		const one = pubsub.subscribe('post', '1');
		pubsub.subscribe('post', '2');
		await pubsub.ready();
		expect(calls).toEqual(['subscribe p:post:1', 'subscribe p:post:2']);
		expect(pubsub.subscriberCount('post', '1')).toBe(1);
		await pubsub.publish('post', '1', 7);
		expect((await one.next()).value).toBe(7);
	});

	test('a malformed payload is skipped and reported', async () => {
		const { listeners, client } = fakeRedis();
		const errors: unknown[] = [];
		const pubsub = redisPubSub<{ t: [payload: number] }>({
			client,
			onError: (error) => errors.push(error),
		});
		const events = pubsub.subscribe('t');
		await pubsub.ready();
		for (const listener of listeners.get('graxia:t') ?? [])
			listener('{nope', 'graxia:t');
		await pubsub.publish('t', 2);
		expect((await events.next()).value).toBe(2);
		expect(errors).toHaveLength(1);
	});

	test('a reconnect re-issues the subscriptions without doubling them', async () => {
		const { calls, subscriber, client } = fakeRedis();
		const pubsub = redisPubSub<{ t: [payload: number] }>({ client });
		const events = pubsub.subscribe('t');
		await pubsub.ready();
		subscriber.onconnect?.(); // the first connection (Bun fires it too)
		await pubsub.ready();
		const before = calls.length;
		subscriber.onconnect?.(); // a reconnect
		await pubsub.ready();
		expect(calls.slice(before)).toEqual([
			'subscribe graxia:t',
			'unsubscribe graxia:t',
		]);
		await pubsub.publish('t', 3);
		expect((await events.next()).value).toBe(3);
	});

	test('many reconnects keep one listener per channel and one delivery', async () => {
		const { listeners, subscriber, client } = fakeRedis();
		const pubsub = redisPubSub<{ t: [payload: number] }>({ client });
		const events = pubsub.subscribe('t');
		await pubsub.ready();
		for (let i = 0; i < 25; i++) {
			subscriber.onconnect?.();
			await pubsub.ready();
		}
		// 2 until nxgt-data#431 ships (inert first listener); never grows
		const count = listeners.get('graxia:t')?.length ?? 0;
		expect(count).toBeGreaterThanOrEqual(1);
		expect(count).toBeLessThanOrEqual(2);
		await pubsub.publish('t', 4);
		expect((await events.next()).value).toBe(4);
		expect(
			await Promise.race([
				events.next(),
				new Promise((r) => setTimeout(r, 50, 'none')),
			]),
		).toBe('none');
	});

	test('dispose never closes the given client when duplicate() rejected', async () => {
		const { calls, client } = fakeRedis();
		(client as unknown as { duplicate: () => Promise<never> }).duplicate =
			async () => {
				throw new Error('no connection');
			};
		const errors: unknown[] = [];
		const pubsub = redisPubSub<{ t: [payload: number] }>({
			client,
			onError: (error) => errors.push(error),
		});
		pubsub.subscribe('t');
		await pubsub.ready();
		await pubsub.dispose();
		expect(errors).toHaveLength(1);
		expect(calls).not.toContain('client closed');
	});

	test('dispose does not hang on a SUBSCRIBE that never completes', async () => {
		const { subscriber, client } = fakeRedis();
		subscriber.subscribe = () => new Promise(() => {});
		const pubsub = redisPubSub<{ t: [payload: number] }>({ client });
		pubsub.subscribe('t');
		const start = Date.now();
		await pubsub.dispose();
		expect(Date.now() - start).toBeLessThan(3000);
	});

	test('a connection error goes to onError, not into the iterator', async () => {
		const { subscriber, client } = fakeRedis();
		const errors: unknown[] = [];
		const pubsub = redisPubSub<{ t: [payload: number] }>({
			client,
			onError: (error) => errors.push(error),
		});
		const events = pubsub.subscribe('t');
		await pubsub.ready();
		subscriber.onclose?.(new Error('lost'));
		expect(errors).toHaveLength(1);
		await pubsub.publish('t', 1);
		expect((await events.next()).value).toBe(1);
	});

	test('dispose ends iterators, closes the subscriber but not a given client', async () => {
		const { calls, client } = fakeRedis();
		const pubsub = redisPubSub<{ t: [payload: number] }>({ client });
		const events = pubsub.subscribe('t');
		await pubsub.ready();
		await pubsub.dispose();
		expect((await events.next()).done).toBe(true);
		expect(calls).toContain('subscriber closed');
		expect(calls).not.toContain('client closed');
		await pubsub.publish('t', 1);
		expect((await pubsub.subscribe('t').next()).done).toBe(true);
	});

	test('a topic without payload publishes null and delivers null', async () => {
		const { calls, client } = fakeRedis();
		const pubsub = redisPubSub<{ ping: [] }>({ client });
		const events = pubsub.subscribe('ping');
		await pubsub.publish('ping');
		expect(await events.next()).toEqual({ done: false, value: null });
		expect(calls).toContain('subscribe graxia:ping');
	});

	test('publish never rejects: a failing client goes to onError', async () => {
		const { client } = fakeRedis();
		const errors: unknown[] = [];
		(client as unknown as { publish: () => Promise<number> }).publish =
			async () => {
				throw new Error('down');
			};
		const pubsub = redisPubSub<{ t: [payload: number] }>({
			client,
			onError: (error) => errors.push(error),
		});
		await expect(pubsub.publish('t', 1)).resolves.toBeUndefined();
		expect(errors).toHaveLength(1);
	});

	describe('abort of the operation', () => {
		type Ctx = { signal: AbortSignal };
		async function open(
			pubsub: ReturnType<typeof redisPubSub<{ t: [payload: number] }>>,
			gate?: (signal: AbortSignal) => Promise<void>,
		) {
			const schema = createSchema<Ctx>()({
				typeDefs: 'type Query { a: Int } type Subscription { t: Int! }',
				resolvers: {
					Query: { a: () => 1 },
					Subscription: {
						t: {
							// an async generator relay: only the signal can end it early
							subscribe: async function* (_root, _args, ctx) {
								await gate?.(ctx.signal);
								yield* pubsub.subscribe('t');
							},
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
					body: JSON.stringify({ query: 'subscription { t }' }),
				}),
			);
			// the generator only starts on the first read
			void response.body?.getReader().read();
			return { graxia, controller };
		}

		test('a client that leaves unsubscribes without any publish', async () => {
			const { calls, client } = fakeRedis();
			const pubsub = redisPubSub<{ t: [payload: number] }>({ client });
			const { graxia, controller } = await open(pubsub);
			await until(() => calls.includes('subscribe graxia:t'));
			expect(pubsub.subscriberCount('t')).toBe(1);
			controller.abort();
			await until(() => calls.includes('unsubscribe graxia:t'));
			expect(pubsub.subscriberCount('t')).toBe(0);
			await graxia.dispose({ timeout: 200 });
			await pubsub.dispose();
		});

		test('an already aborted signal sends no SUBSCRIBE', async () => {
			const { calls, client } = fakeRedis();
			const pubsub = redisPubSub<{ t: [payload: number] }>({ client });
			let reached = false;
			const { graxia, controller } = await open(pubsub, async (signal) => {
				await new Promise((resolve) =>
					signal.addEventListener('abort', resolve, { once: true }),
				);
				reached = true;
			});
			controller.abort();
			await until(() => reached);
			await new Promise((resolve) => setTimeout(resolve, 20));
			expect(calls.some((c) => c.startsWith('subscribe'))).toBe(false);
			expect(pubsub.subscriberCount('t')).toBe(0);
			await graxia.dispose({ timeout: 200 });
			await pubsub.dispose();
		});
	});
});
