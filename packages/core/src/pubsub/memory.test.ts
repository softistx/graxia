import { describe, expect, test } from 'bun:test';
import { runWithContext } from '../server/context';
import { createPubSub } from './memory';

type Topics = {
	tick: [payload: number];
	post: [id: string, payload: { id: string }];
	ping: [];
};

describe('createPubSub', () => {
	test('fans out to every subscriber in order', async () => {
		const pubsub = createPubSub<Topics>();
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
		const pubsub = createPubSub<Topics>();
		const events = pubsub.subscribe('post', '1');
		await pubsub.publish('post', '1', { id: '1' });
		expect((await events.next()).value).toEqual({ id: '1' });
	});

	test('resolves a pending next() on publish', async () => {
		const pubsub = createPubSub<Topics>();
		const events = pubsub.subscribe('tick');
		const pending = events.next();
		await pubsub.publish('tick', 7);
		expect(await pending).toEqual({ done: false, value: 7 });
	});

	test('topics are isolated', async () => {
		const pubsub = createPubSub<Topics>();
		const events = pubsub.subscribe('post', '1');
		await pubsub.publish('post', '2', { id: '2' });
		await pubsub.publish('post', '1', { id: '1' });
		expect((await events.next()).value).toEqual({ id: '1' });
	});

	test('break in for await removes the subscriber', async () => {
		const pubsub = createPubSub<Topics>();
		const events = pubsub.subscribe('tick');
		await pubsub.publish('tick', 1);
		for await (const _ of events) break;
		expect(pubsub.subscriberCount('tick')).toBe(0);
	});

	test('throw() removes the subscriber', async () => {
		const pubsub = createPubSub<Topics>();
		const events = pubsub.subscribe('tick');
		await expect(events.throw?.(new Error('x'))).rejects.toThrow('x');
		expect(pubsub.subscriberCount('tick')).toBe(0);
	});

	test('overflow drops the oldest and reports each drop', async () => {
		const dropped: unknown[] = [];
		const pubsub = createPubSub<Topics>({
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

	test('dispose ends open iterators; later subscribe is done and publish a no-op', async () => {
		const pubsub = createPubSub<Topics>();
		const events = pubsub.subscribe('tick');
		const pending = events.next();
		await pubsub.dispose();
		expect((await pending).done).toBe(true);
		expect(pubsub.subscriberCount('tick')).toBe(0);
		await pubsub.publish('tick', 1);
		expect((await pubsub.subscribe('tick').next()).done).toBe(true);
	});

	test('a throwing onOverflow neither rejects publish nor starves others', async () => {
		const pubsub = createPubSub<Topics>({
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

	test('an id is a channel of its own: topic:id', async () => {
		const pubsub = createPubSub<Topics>();
		const one = pubsub.subscribe('post', '1');
		const two = pubsub.subscribe('post', '2');
		expect(pubsub.subscriberCount('post', '1')).toBe(1);
		await pubsub.publish('post', '2', { id: 'b' });
		await pubsub.publish('post', '1', { id: 'a' });
		expect((await one.next()).value).toEqual({ id: 'a' });
		expect((await two.next()).value).toEqual({ id: 'b' });
		await one.return?.();
		expect(pubsub.subscriberCount('post', '1')).toBe(0);
	});

	test('a topic without payload publishes and yields null like Yoga', async () => {
		const pubsub = createPubSub<Topics>();
		const events = pubsub.subscribe('ping');
		await pubsub.publish('ping');
		expect(await events.next()).toEqual({ done: false, value: null });
	});

	test('return() while next() is pending ends the iterator and unsubscribes', async () => {
		const pubsub = createPubSub<Topics>();
		const events = pubsub.subscribe('tick');
		const pending = events.next();
		await events.return?.();
		expect((await pending).done).toBe(true);
		expect(pubsub.subscriberCount('tick')).toBe(0);
	});

	test('an invalid bufferSize falls back to the default', async () => {
		for (const bufferSize of [Number.NaN, Number.POSITIVE_INFINITY, 0, -3]) {
			const pubsub = createPubSub<Topics>({ bufferSize });
			const events = pubsub.subscribe('tick');
			for (let n = 0; n < 5; n++) await pubsub.publish('tick', n);
			expect((await events.next()).value).toBe(0);
		}
	});

	test('the operation signal ends the subscriber at once, with no next() pending', async () => {
		const pubsub = createPubSub<Topics>();
		const controller = new AbortController();
		const events = runWithContext({ signal: controller.signal }, () =>
			pubsub.subscribe('tick'),
		);
		expect(pubsub.subscriberCount('tick')).toBe(1);
		controller.abort();
		expect(pubsub.subscriberCount('tick')).toBe(0);
		expect((await events.next()).done).toBe(true);
	});

	test('an already aborted operation signal registers nothing', async () => {
		const pubsub = createPubSub<Topics>();
		const events = runWithContext({ signal: AbortSignal.abort() }, () =>
			pubsub.subscribe('tick'),
		);
		expect(pubsub.subscriberCount('tick')).toBe(0);
		expect((await events.next()).done).toBe(true);
	});

	test('no abort listener is left on the signal once the subscription ends', async () => {
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
		const pubsub = createPubSub<Topics>();
		const events = runWithContext({ signal }, () => pubsub.subscribe('tick'));
		await events.return();
		expect([added, removed]).toEqual([1, 1]);
	});
});
