import type { PubSub, PubSubTopics, SubscribeOptions } from './types';

/** Options of `createMemoryPubSub`. */
export interface MemoryPubSubOptions {
	/** Events buffered per subscriber before the oldest is dropped. Default 1000. */
	bufferSize?: number;
	/** Called once per dropped event when a subscriber's buffer overflows. */
	onOverflow?: (info: { topic: string; dropped: unknown }) => void;
}

/** An in-process {@link PubSub}, with a subscriber count for tests. */
export interface MemoryPubSub<Topics extends PubSubTopics>
	extends PubSub<Topics> {
	/** Number of open subscriptions on `topic`. */
	subscriberCount(topic: keyof Topics & string): number;
}

interface Subscriber {
	push(value: unknown): void;
	end(): void;
}

const DONE = { done: true, value: undefined } as const;

/**
 * Creates an in-memory PubSub. It lives in one process: use a networked
 * implementation to fan out across processes. A slow subscriber never blocks
 * `publish`; its oldest events are dropped past `bufferSize`.
 *
 * @example
 * const pubsub = createMemoryPubSub<{ tick: number }>();
 * const events = pubsub.subscribe('tick');
 * await pubsub.publish('tick', 1);
 * (await events.next()).value; // 1
 */
export function createMemoryPubSub<Topics extends PubSubTopics>(
	options: MemoryPubSubOptions = {},
): MemoryPubSub<Topics> {
	const defaultSize = options.bufferSize ?? 1000;
	const topics = new Map<string, Set<Subscriber>>();
	let disposed = false;

	const finishedIterator = (): AsyncIterableIterator<never> => ({
		next: async () => DONE,
		return: async () => DONE,
		throw: async (error?: unknown) => {
			throw error;
		},
		[Symbol.asyncIterator]() {
			return this;
		},
	});

	function subscribe<K extends keyof Topics & string>(
		topic: K,
		subscribeOptions: SubscribeOptions = {},
	): AsyncIterableIterator<Topics[K]> {
		const { signal } = subscribeOptions;
		if (disposed || signal?.aborted) return finishedIterator();
		const limit = Math.max(1, subscribeOptions.bufferSize ?? defaultSize);
		const buffer: Topics[K][] = [];
		const waiting: ((r: IteratorResult<Topics[K]>) => void)[] = [];
		let ended = false;

		const subscriber: Subscriber = {
			push(value) {
				const waiter = waiting.shift();
				if (waiter) return waiter({ done: false, value: value as Topics[K] });
				if (buffer.length >= limit) {
					const dropped = buffer.shift();
					options.onOverflow?.({ topic, dropped });
				}
				buffer.push(value as Topics[K]);
			},
			end,
		};

		function end(): void {
			if (ended) return;
			ended = true;
			signal?.removeEventListener('abort', end);
			const set = topics.get(topic);
			set?.delete(subscriber);
			if (set?.size === 0) topics.delete(topic);
			for (const waiter of waiting.splice(0)) waiter(DONE);
		}

		const existing = topics.get(topic);
		const set = existing ?? new Set<Subscriber>();
		if (!existing) topics.set(topic, set);
		set.add(subscriber);
		signal?.addEventListener('abort', end, { once: true });

		return {
			next() {
				if (buffer.length > 0)
					return Promise.resolve({
						done: false,
						value: buffer.shift() as Topics[K],
					});
				if (ended) return Promise.resolve(DONE);
				return new Promise((resolve) => waiting.push(resolve));
			},
			async return() {
				end();
				buffer.length = 0;
				return DONE;
			},
			async throw(error?: unknown) {
				end();
				buffer.length = 0;
				throw error;
			},
			[Symbol.asyncIterator]() {
				return this;
			},
		};
	}

	return {
		async publish(topic, payload) {
			if (disposed) return;
			const set = topics.get(topic);
			if (set) for (const subscriber of [...set]) subscriber.push(payload);
		},
		subscribe,
		async dispose() {
			disposed = true;
			for (const set of [...topics.values()])
				for (const subscriber of [...set]) subscriber.end();
			topics.clear();
		},
		subscriberCount: (topic) => topics.get(topic)?.size ?? 0,
	};
}
