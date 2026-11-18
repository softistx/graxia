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

	test('a throwing onOverflow neither rejects publish nor starves others', async () => {
		const pubsub = createMemoryPubSub<Topics>({
			bufferSize: 1,
			onOverflow: () => {
				throw new Error('observer');
			},
		});
		const a = pubsub.subscribe('tick');
		const b = pubsub.subscribe('tick');
		await pubsub.publish('tick', 1);
		await pubsub.publish('tick', 2);
		expect((await a.next()).value).toBe(2);
		expect((await b.next()).value).toBe(2);
	});

	test('an invalid bufferSize falls back to the default', async () => {
		for (const bufferSize of [Number.NaN, Number.POSITIVE_INFINITY, 0, -3]) {
			const pubsub = createMemoryPubSub<Topics>({ bufferSize });
			const events = pubsub.subscribe('tick', { bufferSize });
			for (let n = 0; n < 5; n++) await pubsub.publish('tick', n);
			expect((await events.next()).value).toBe(0);
		}
		const pubsub = createMemoryPubSub<Topics>();
		const events = pubsub.subscribe('tick', { bufferSize: 2.9 });
		for (const n of [1, 2, 3]) await pubsub.publish('tick', n);
		expect((await events.next()).value).toBe(2);
	});

	test('abort and dispose discard buffered events', async () => {
		const pubsub = createMemoryPubSub<Topics>();
		const controller = new AbortController();
		const a = pubsub.subscribe('tick', { signal: controller.signal });
		const b = pubsub.subscribe('tick');
		await pubsub.publish('tick', 1);
		controller.abort();
		expect((await a.next()).done).toBe(true);
		await pubsub.dispose();
		expect((await b.next()).done).toBe(true);
	});

	test('removes its abort listener when the subscription ends', async () => {
		const signal = new AbortController().signal;
		let added = 0;
		let removed = 0;
		const add = signal.addEventListener.bind(signal);
		const remove = signal.removeEventListener.bind(signal);
		signal.addEventListener = ((...args: Parameters<typeof add>) => {
			added++;
			add(...args);
		}) as typeof add;
		signal.removeEventListener = ((...args: Parameters<typeof remove>) => {
			removed++;
			remove(...args);
		}) as typeof remove;
		const pubsub = createMemoryPubSub<Topics>();
		const events = pubsub.subscribe('tick', { signal });
		await events.return?.();
		expect(added).toBe(1);
		expect(removed).toBe(1);
	});
});
