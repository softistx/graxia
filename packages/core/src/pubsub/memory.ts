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

/** A usable buffer size: finite, floored, at least 1; otherwise `fallback`. */
function toBufferSize(value: number | undefined, fallback: number): number {
	if (value === undefined || !Number.isFinite(value)) return fallback;
	const size = Math.floor(value);
	return size >= 1 ? size : fallback;
}

interface SubscriberInit {
	topic: string;
	limit: number;
	signal: AbortSignal | undefined;
	onOverflow: MemoryPubSubOptions['onOverflow'];
	/** Removes the subscriber from the registry. */
	detach(subscriber: Subscriber): void;
}

/** One subscriber: its bounded buffer, its pending readers and its iterator. */
function createSubscriber<T>(init: SubscriberInit): {
	subscriber: Subscriber;
	iterator: AsyncIterableIterator<T>;
} {
	const { topic, limit, signal, onOverflow } = init;
	const buffer: T[] = [];
	const waiting: ((result: IteratorResult<T>) => void)[] = [];
	let ended = false;

	const subscriber: Subscriber = {
		push(value) {
			const waiter = waiting.shift();
			if (waiter) return waiter({ done: false, value: value as T });
			if (buffer.length >= limit) {
				const dropped = buffer.shift();
				try {
					onOverflow?.({ topic, dropped });
				} catch {
					// a faulty observer never breaks publishing
				}
			}
			buffer.push(value as T);
		},
		end,
	};

	function end(): void {
		if (ended) return;
		ended = true;
		signal?.removeEventListener('abort', end);
		buffer.length = 0;
		init.detach(subscriber);
		for (const waiter of waiting.splice(0)) waiter(DONE);
	}
	signal?.addEventListener('abort', end, { once: true });

	const iterator: AsyncIterableIterator<T> = {
		next() {
			if (buffer.length > 0)
				return Promise.resolve({ done: false, value: buffer.shift() as T });
			if (ended) return Promise.resolve(DONE);
			return new Promise((resolve) => waiting.push(resolve));
		},
		async return() {
			end();
			return DONE;
		},
		async throw(error?: unknown) {
			end();
			throw error;
		},
		[Symbol.asyncIterator]() {
			return this;
		},
	};
	return { subscriber, iterator };
}

/**
 * Creates an in-memory PubSub. It lives in one process: use a networked
 * implementation to fan out across processes. A slow subscriber never blocks
 * `publish`; its oldest events are dropped past `bufferSize`. Aborting a
 * signal, `return()` or `dispose()` stop a subscription at once: buffered
 * events are discarded.
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
	const defaultSize = toBufferSize(options.bufferSize, 1000);
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
		const { subscriber, iterator } = createSubscriber<Topics[K]>({
			topic,
			limit: toBufferSize(subscribeOptions.bufferSize, defaultSize),
			signal,
			onOverflow: options.onOverflow,
			detach(done) {
				const set = topics.get(topic);
				set?.delete(done);
				if (set?.size === 0) topics.delete(topic);
			},
		});
		const existing = topics.get(topic);
		const set = existing ?? new Set<Subscriber>();
		if (!existing) topics.set(topic, set);
		set.add(subscriber);
		return iterator;
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
