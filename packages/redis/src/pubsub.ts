import {
	createPubSub,
	type PubSub,
	type PubSubIterator,
	type PubSubPayload,
	type PubSubSubscribeArgs,
	type PubSubTopics,
	tryGetContext,
} from '@graxia/core';
import { channelOf, splitPublishArgs } from './channel';
import {
	closeQuietly,
	type RedisConnection,
	resolveClient,
} from './connection';
import { createTopicSubscriptions } from './subscriptions';

/** The local fan-out is keyed by channel, one level below the typed interface. */
type ChannelTopics = Record<string, [unknown]>;

/** Options of {@link redisPubSub}. */
export type RedisPubSubOptions = RedisConnection & {
	/** Prepended to every Redis channel. Default `graxia:`. */
	prefix?: string;
	/** Events buffered per subscriber before the oldest is dropped. Default 1000. */
	bufferSize?: number;
	/** Called once per dropped event when a subscriber's buffer overflows. */
	onOverflow?: (info: { topic: string; dropped: unknown }) => void;
	/** Payload to string. Default `JSON.stringify`. */
	serialize?: (payload: unknown) => string;
	/** String to payload. Default `JSON.parse`. A throw skips the message and goes to `onError`. */
	deserialize?: (message: string) => unknown;
	/** Connection, subscription and payload errors; never thrown into an iterator. */
	onError?: (error: unknown) => void;
};

/** A {@link PubSub} across processes on Redis. */
export interface RedisPubSub<Topics extends PubSubTopics>
	extends PubSub<Topics> {
	/**
	 * Resolves once every Redis SUBSCRIBE issued so far (by any `subscribe()`
	 * of this instance) is acknowledged. Await it before telling another
	 * process that events may flow. Never rejects.
	 */
	ready(): Promise<void>;
	/** Number of open local subscriptions on `topic`. */
	subscriberCount<K extends keyof Topics & string>(
		...args: PubSubSubscribeArgs<Topics, K>
	): number;
}

/**
 * A {@link PubSub} on Redis, interchangeable with `createPubSub`. One
 * dedicated subscriber connection (opened on the first `subscribe()`) carries
 * one Redis SUBSCRIBE per topic, shared by every local subscriber of that
 * topic and dropped when the last one leaves. Delivery is at most once: events
 * published while a connection is down are lost, and events published by
 * another process right after `subscribe()` returns may precede the
 * acknowledged SUBSCRIBE (`ready()`). `publish` on the same instance waits for
 * its own pending subscriptions first.
 *
 * @example
 * type Topics = { post: [id: string, payload: { id: string }] };
 * const pubsub = redisPubSub<Topics>({ url: process.env.REDIS_URL });
 * const events = pubsub.subscribe('post', '42'); // Redis channel `graxia:post:42`
 * await pubsub.publish('post', '42', { id: '42' });
 */
export function redisPubSub<Topics extends PubSubTopics>(
	options: RedisPubSubOptions = {},
): RedisPubSub<Topics> {
	const { client, owned } = resolveClient(options);
	const prefix = options.prefix ?? 'graxia:';
	const serialize = options.serialize ?? JSON.stringify;
	const deserialize = options.deserialize ?? JSON.parse;
	const report = (error: unknown) => {
		try {
			options.onError?.(error);
		} catch {
			// a faulty observer never breaks delivery
		}
	};
	const local = createPubSub<ChannelTopics>({
		...(options.bufferSize !== undefined && { bufferSize: options.bufferSize }),
		...(options.onOverflow && { onOverflow: options.onOverflow }),
	});
	const subscriptions = createTopicSubscriptions({
		client,
		prefix,
		report,
		onMessage(topic, message) {
			let payload: unknown;
			try {
				payload = deserialize(message);
			} catch (error) {
				report(error);
				return;
			}
			void local.publish(topic, payload);
		},
	});
	let disposed = false;

	const ctx: SubscribeContext = {
		local,
		subscriptions,
		isDisposed: () => disposed,
	};

	function subscribe<K extends keyof Topics & string>(
		...args: PubSubSubscribeArgs<Topics, K>
	): PubSubIterator<PubSubPayload<Topics[K]>> {
		const channel = channelOf(args[0], args[1] as string | number | undefined);
		const signal = tryGetContext<{ signal?: AbortSignal }>()?.signal;
		return subscribeChannel(ctx, channel, signal) as PubSubIterator<
			PubSubPayload<Topics[K]>
		>;
	}

	return {
		async publish(topic, ...args) {
			if (disposed) return;
			const { id, payload } = splitPublishArgs(args);
			try {
				await subscriptions.ready();
				await client.publish(
					prefix + channelOf(topic, id),
					serialize(payload ?? null),
				);
			} catch (error) {
				// never rejects, so an un-awaited publish (as in Yoga) is safe
				report(error);
			}
		},
		subscribe,
		ready: () => subscriptions.ready(),
		subscriberCount: (...args) =>
			local.subscriberCount(
				channelOf(args[0], args[1] as string | number | undefined),
			),
		async dispose() {
			if (disposed) return;
			disposed = true;
			await local.dispose();
			await subscriptions.close();
			if (owned) closeQuietly(client);
		},
	};
}

/** What {@link subscribeChannel} needs from a `redisPubSub` instance. */
type SubscribeContext = {
	local: PubSub<ChannelTopics>;
	subscriptions: ReturnType<typeof createTopicSubscriptions>;
	isDisposed: () => boolean;
};

/**
 * Subscribes locally to `channel` and takes one Redis SUBSCRIBE for it, given
 * back when the iterator finishes, is returned, or `signal` aborts. A disposed
 * instance or an already aborted signal gives a finished iterator and sends
 * nothing.
 */
function subscribeChannel(
	ctx: SubscribeContext,
	channel: string,
	signal: AbortSignal | undefined,
): PubSubIterator<unknown> {
	const inner = ctx.local.subscribe(channel) as PubSubIterator<unknown>;
	if (ctx.isDisposed() || signal?.aborted) return inner;
	ctx.subscriptions.acquire(channel);
	let released = false;
	const leave = (): void => {
		if (released) return;
		released = true;
		signal?.removeEventListener('abort', leave);
		if (!ctx.isDisposed()) ctx.subscriptions.release(channel);
	};
	signal?.addEventListener('abort', leave, { once: true });
	return releasing(inner, leave);
}

/** Wraps `inner` so that finishing, `return()` or `throw()` calls `leave` once. */
function releasing<T>(
	inner: PubSubIterator<T>,
	leave: () => void,
): PubSubIterator<T> {
	return {
		async next() {
			const result = await inner.next();
			if (result.done) leave();
			return result;
		},
		async return() {
			leave();
			return inner.return();
		},
		async throw(error?: unknown) {
			leave();
			return inner.throw(error);
		},
		[Symbol.asyncIterator]() {
			return this;
		},
	};
}
