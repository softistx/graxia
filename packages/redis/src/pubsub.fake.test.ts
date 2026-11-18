import { describe, expect, test } from 'bun:test';
import { GraxiaConfigError } from '@graxia/core';
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
		const pubsub = redisPubSub<{ t: number }>({ client, prefix: 'p:' });
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

	test('abort releases the topic and a pre-aborted signal registers nothing', async () => {
		const { calls, client } = fakeRedis();
		const pubsub = redisPubSub<{ t: number }>({ client });
		const controller = new AbortController();
		const events = pubsub.subscribe('t', { signal: controller.signal });
		await pubsub.ready();
		controller.abort();
		expect((await events.next()).done).toBe(true);
		await until(() => calls.includes('unsubscribe graxia:t'));
		const aborted = pubsub.subscribe('t', { signal: controller.signal });
		expect((await aborted.next()).done).toBe(true);
		expect(calls.filter((c) => c.startsWith('subscribe'))).toHaveLength(1);
	});

	test('a malformed payload is skipped and reported', async () => {
		const { listeners, client } = fakeRedis();
		const errors: unknown[] = [];
		const pubsub = redisPubSub<{ t: number }>({
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
		const pubsub = redisPubSub<{ t: number }>({ client });
		const events = pubsub.subscribe('t');
		await pubsub.ready();
		subscriber.onconnect?.();
		await pubsub.ready();
		expect(calls.slice(1)).toEqual([
			'subscribe graxia:t',
			'unsubscribe graxia:t',
		]);
		await pubsub.publish('t', 3);
		expect((await events.next()).value).toBe(3);
	});

	test('many reconnects keep one listener per channel and one delivery', async () => {
		const { listeners, subscriber, client } = fakeRedis();
		const pubsub = redisPubSub<{ t: number }>({ client });
		const events = pubsub.subscribe('t');
		await pubsub.ready();
		for (let i = 0; i < 25; i++) {
			subscriber.onconnect?.();
			await pubsub.ready();
		}
		expect(listeners.get('graxia:t')).toHaveLength(1);
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
		const pubsub = redisPubSub<{ t: number }>({
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
		const pubsub = redisPubSub<{ t: number }>({ client });
		pubsub.subscribe('t');
		const start = Date.now();
		await pubsub.dispose();
		expect(Date.now() - start).toBeLessThan(3000);
	});

	test('a connection error goes to onError, not into the iterator', async () => {
		const { subscriber, client } = fakeRedis();
		const errors: unknown[] = [];
		const pubsub = redisPubSub<{ t: number }>({
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
		const pubsub = redisPubSub<{ t: number }>({ client });
		const events = pubsub.subscribe('t');
		await pubsub.ready();
		await pubsub.dispose();
		expect((await events.next()).done).toBe(true);
		expect(calls).toContain('subscriber closed');
		expect(calls).not.toContain('client closed');
		await pubsub.publish('t', 1);
		expect((await pubsub.subscribe('t').next()).done).toBe(true);
	});
});
