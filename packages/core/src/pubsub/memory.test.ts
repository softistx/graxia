import { describe, expect, test } from 'bun:test';
import { createMemoryPubSub } from './memory';

type Topics = { tick: number; [k: `post:${string}`]: { id: string } };

describe('createMemoryPubSub', () => {
	test('fans out to every subscriber in order', async () => {
		const pubsub = createMemoryPubSub<Topics>();
		const a = pubsub.subscribe('tick');
		const b = pubsub.subscribe('tick');
		await pubsub.publish('tick', 1);
		await pubsub.publish('tick', 2);
		expect((await a.next()).value).toBe(1);
		expect((await a.next()).value).toBe(2);
		expect((await b.next()).value).toBe(1);
		expect((await b.next()).value).toBe(2);
	});

	test('delivers an event published right after subscribe', async () => {
		const pubsub = createMemoryPubSub<Topics>();
		const events = pubsub.subscribe('post:1');
		await pubsub.publish('post:1', { id: '1' });
		expect((await events.next()).value).toEqual({ id: '1' });
	});

	test('resolves a pending next() on publish', async () => {
		const pubsub = createMemoryPubSub<Topics>();
		const events = pubsub.subscribe('tick');
		const pending = events.next();
		await pubsub.publish('tick', 7);
		expect(await pending).toEqual({ done: false, value: 7 });
	});

	test('topics are isolated', async () => {
		const pubsub = createMemoryPubSub<Topics>();
		const events = pubsub.subscribe('post:1');
		await pubsub.publish('post:2', { id: '2' });
		await pubsub.publish('post:1', { id: '1' });
		expect((await events.next()).value).toEqual({ id: '1' });
	});

	test('break in for await removes the subscriber', async () => {
		const pubsub = createMemoryPubSub<Topics>();
		const events = pubsub.subscribe('tick');
		await pubsub.publish('tick', 1);
		for await (const _ of events) break;
		expect(pubsub.subscriberCount('tick')).toBe(0);
	});

	test('throw() removes the subscriber', async () => {
		const pubsub = createMemoryPubSub<Topics>();
		const events = pubsub.subscribe('tick');
		await expect(events.throw?.(new Error('x'))).rejects.toThrow('x');
		expect(pubsub.subscriberCount('tick')).toBe(0);
	});

	test('abort while next() is pending ends the iterator and removes the listener', async () => {
		const pubsub = createMemoryPubSub<Topics>();
		const controller = new AbortController();
		const events = pubsub.subscribe('tick', { signal: controller.signal });
		const pending = events.next();
		expect(pubsub.subscriberCount('tick')).toBe(1);
		controller.abort();
		expect((await pending).done).toBe(true);
		expect(pubsub.subscriberCount('tick')).toBe(0);
	});

	test('an aborted signal yields a done iterator and registers nothing', async () => {
		const pubsub = createMemoryPubSub<Topics>();
		const events = pubsub.subscribe('tick', { signal: AbortSignal.abort() });
		expect(pubsub.subscriberCount('tick')).toBe(0);
		expect((await events.next()).done).toBe(true);
	});

	test('overflow drops the oldest and reports each drop', async () => {
		const dropped: unknown[] = [];
		const pubsub = createMemoryPubSub<Topics>({
			bufferSize: 2,
			onOverflow: (info) => dropped.push(info),
		});
		const events = pubsub.subscribe('tick');
		for (const n of [1, 2, 3, 4]) await pubsub.publish('tick', n);
		expect(dropped).toEqual([
			{ topic: 'tick', dropped: 1 },
			{ topic: 'tick', dropped: 2 },
		]);
		expect((await events.next()).value).toBe(3);
		expect((await events.next()).value).toBe(4);
	});

	test('a per-subscribe bufferSize overrides the default', async () => {
		const pubsub = createMemoryPubSub<Topics>();
		const events = pubsub.subscribe('tick', { bufferSize: 1 });
		await pubsub.publish('tick', 1);
		await pubsub.publish('tick', 2);
		expect((await events.next()).value).toBe(2);
	});

	test('dispose ends open iterators; later subscribe is done and publish a no-op', async () => {
		const pubsub = createMemoryPubSub<Topics>();
		const events = pubsub.subscribe('tick');
		const pending = events.next();
		await pubsub.dispose();
		expect((await pending).done).toBe(true);
		expect(pubsub.subscriberCount('tick')).toBe(0);
		await pubsub.publish('tick', 1);
		expect((await pubsub.subscribe('tick').next()).done).toBe(true);
	});
});
