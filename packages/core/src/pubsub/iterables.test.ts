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

describe('derived iterator ordering and closing', () => {
	test('return() during an in-flight async predicate yields done', async () => {
		const pubsub = createMemoryPubSub<{ tick: number }>();
		let release: () => void = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const events = filterIterable(pubsub.subscribe('tick'), async () => {
			await gate;
			return true;
		});
		await pubsub.publish('tick', 1);
		const pending = events.next();
		await Bun.sleep(5);
		await events.return?.();
		release();
		expect((await pending).done).toBe(true);
		expect(pubsub.subscriberCount('tick')).toBe(0);
	});

	test('concurrent next() calls keep order under async predicates', async () => {
		const events = filterIterable(numbers(1, 2, 3), async (n) => {
			await Bun.sleep(4 - n);
			return true;
		});
		const results = await Promise.all([
			events.next(),
			events.next(),
			events.next(),
		]);
		expect(results.map((r) => r.value)).toEqual([1, 2, 3]);
	});

	test('throw() closes the source and rejects, on both iterators', async () => {
		const pubsub = createMemoryPubSub<{ tick: number }>();
		const filtered = filterIterable(pubsub.subscribe('tick'), () => true);
		await expect(filtered.throw?.(new Error('f'))).rejects.toThrow('f');
		expect(pubsub.subscriberCount('tick')).toBe(0);
		const mapped = mapIterable(pubsub.subscribe('tick'), (n) => n);
		await expect(mapped.throw?.(new Error('m'))).rejects.toThrow('m');
		expect(pubsub.subscriberCount('tick')).toBe(0);
	});

	test('a failing source marks the iterator finished without a second return', async () => {
		let returned = 0;
		const failing: AsyncIterable<number> = {
			[Symbol.asyncIterator]: () => ({
				next: async () => {
					throw new Error('source');
				},
				return: async () => {
					returned++;
					return { done: true, value: undefined };
				},
			}),
		};
		const events = mapIterable(failing, (n) => n);
		await expect(events.next()).rejects.toThrow('source');
		expect((await events.next()).done).toBe(true);
		expect(returned).toBe(0);
	});
});
