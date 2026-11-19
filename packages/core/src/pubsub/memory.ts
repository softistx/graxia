import { tryGetContext } from '../server/context';
import {
	channelOf,
	type PubSub,
	type PubSubIterator,
	type PubSubPayload,
	type PubSubSubscribeArgs,
	type PubSubTopics,
	splitPublishArgs,
} from './types';

/** Options of `createPubSub`. */
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
	subscriberCount<K extends keyof Topics & string>(
		...args: PubSubSubscribeArgs<Topics, K>
	): number;
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
	onOverflow: MemoryPubSubOptions['onOverflow'];
	/** The operation's signal, when subscribing inside one: aborting ends the subscriber at once. */
	signal: AbortSignal | undefined;
	/** Removes the subscriber from the registry. */
	detach(subscriber: Subscriber): void;
}

/** One subscriber: its bounded buffer, its pending readers and its iterator. */
function createSubscriber<T>(init: SubscriberInit): {
	subscriber: Subscriber;
	iterator: PubSubIterator<T>;
} {
	const { topic, limit, onOverflow, signal } = init;
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

	if (signal?.aborted) end();
	else signal?.addEventListener('abort', end, { once: true });

	const iterator: PubSubIterator<T> = {
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
 * Creates an in-memory PubSub, with the shape of GraphQL Yoga's `createPubSub`.
 * It lives in one process: use a networked implementation to fan out across
 * processes. A slow subscriber never blocks `publish`; its oldest events are
 * dropped past `bufferSize`. `return()` (which the engine calls when the
 * operation's signal aborts) and `dispose()` stop a subscription at once:
 * buffered events are discarded.
 *
 * @example
 * const pubsub = createPubSub<{ tick: [payload: number] }>();
 * const events = pubsub.subscribe('tick');
 * await pubsub.publish('tick', 1);
 * (await events.next()).value; // 1
 */
export function createPubSub<Topics extends PubSubTopics>(
	options: MemoryPubSubOptions = {},
): MemoryPubSub<Topics> {
	const defaultSize = toBufferSize(options.bufferSize, 1000);
	const channels = new Map<string, Set<Subscriber>>();
	let disposed = false;

	const finishedIterator = (): PubSubIterator<never> => ({
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
		...args: PubSubSubscribeArgs<Topics, K>
	): PubSubIterator<PubSubPayload<Topics[K]>> {
		const channel = channelOf(args[0], args[1] as string | number | undefined);
		const signal = tryGetContext<{ signal?: AbortSignal }>()?.signal;
		if (disposed || signal?.aborted) return finishedIterator();
		const { subscriber, iterator } = createSubscriber<PubSubPayload<Topics[K]>>(
			{
				topic: channel,
				limit: defaultSize,
				onOverflow: options.onOverflow,
				signal,
				detach(done) {
					const set = channels.get(channel);
					set?.delete(done);
					if (set?.size === 0) channels.delete(channel);
				},
			},
		);
		const existing = channels.get(channel);
		const set = existing ?? new Set<Subscriber>();
		if (!existing) channels.set(channel, set);
		set.add(subscriber);
		return iterator;
	}

	return {
		async publish(topic, ...args) {
			if (disposed) return;
			const { id, payload } = splitPublishArgs(args);
			const set = channels.get(channelOf(topic, id));
			if (set)
				for (const subscriber of [...set]) subscriber.push(payload ?? null);
		},
		subscribe,
		async dispose() {
			disposed = true;
			for (const set of [...channels.values()])
				for (const subscriber of [...set]) subscriber.end();
			channels.clear();
		},
		subscriberCount: (...args) =>
			channels.get(channelOf(args[0], args[1] as string | number | undefined))
				?.size ?? 0,
	};
}
