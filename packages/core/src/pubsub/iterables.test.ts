import { describe, expect, test } from 'bun:test';
import { filterIterable, mapIterable } from './iterables';
import { createMemoryPubSub } from './memory';

async function* numbers(...values: number[]) {
	yield* values;
}

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
	const out: T[] = [];
	for await (const value of source) out.push(value);
	return out;
}

describe('filterIterable', () => {
	test('filters with a sync and an async predicate', async () => {
		expect(
			await collect(filterIterable(numbers(1, 2, 3, 4), (n) => n % 2 === 0)),
		).toEqual([2, 4]);
		expect(
			await collect(filterIterable(numbers(1, 2, 3, 4), async (n) => n > 2)),
		).toEqual([3, 4]);
	});

	test('break unsubscribes the source', async () => {
		const pubsub = createMemoryPubSub<{ tick: number }>();
		const events = filterIterable(pubsub.subscribe('tick'), () => true);
		await pubsub.publish('tick', 1);
		for await (const _ of events) break;
		expect(pubsub.subscriberCount('tick')).toBe(0);
	});

	test('a throwing predicate returns the source then rejects', async () => {
		const pubsub = createMemoryPubSub<{ tick: number }>();
		const events = filterIterable(pubsub.subscribe('tick'), () => {
			throw new Error('boom');
		});
		await pubsub.publish('tick', 1);
		await expect(events.next()).rejects.toThrow('boom');
		expect(pubsub.subscriberCount('tick')).toBe(0);
	});
});

describe('mapIterable', () => {
	test('maps with a sync and an async function', async () => {
		expect(await collect(mapIterable(numbers(1, 2), (n) => n * 10))).toEqual([
			10, 20,
		]);
		expect(
			await collect(mapIterable(numbers(1, 2), async (n) => `#${n}`)),
		).toEqual(['#1', '#2']);
	});

	test('a throwing fn returns the source then rejects', async () => {
		const pubsub = createMemoryPubSub<{ tick: number }>();
		const events = mapIterable(pubsub.subscribe('tick'), () => {
			throw new Error('bad');
		});
		await pubsub.publish('tick', 1);
		await expect(events.next()).rejects.toThrow('bad');
		expect(pubsub.subscriberCount('tick')).toBe(0);
	});

	test('return() is forwarded to the source', async () => {
		const pubsub = createMemoryPubSub<{ tick: number }>();
		const events = mapIterable(pubsub.subscribe('tick'), (n) => n);
		await events.return?.();
		expect(pubsub.subscriberCount('tick')).toBe(0);
	});
});
