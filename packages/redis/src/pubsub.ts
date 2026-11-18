import {
	createMemoryPubSub,
	type PubSub,
	type PubSubTopics,
	type SubscribeOptions,
} from '@graxia/core';
import {
	closeQuietly,
	type RedisConnection,
	resolveClient,
} from './connection';
import { createTopicSubscriptions } from './subscriptions';

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
	subscriberCount(topic: keyof Topics & string): number;
}

/**
 * A {@link PubSub} on Redis, interchangeable with `createMemoryPubSub`. One
 * dedicated subscriber connection (opened on the first `subscribe()`) carries
 * one Redis SUBSCRIBE per topic, shared by every local subscriber of that
 * topic and dropped when the last one leaves. Delivery is at most once: events
 * published while a connection is down are lost, and events published by
 * another process right after `subscribe()` returns may precede the
 * acknowledged SUBSCRIBE (`ready()`). `publish` on the same instance waits for
 * its own pending subscriptions first.
 *
 * @example
 * type Topics = { [k: `post:${string}`]: { id: string } };
 * const pubsub = redisPubSub<Topics>({ url: process.env.REDIS_URL });
 * const events = pubsub.subscribe('post:42', { signal });
 * await pubsub.publish('post:42', { id: '42' });
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
	const local = createMemoryPubSub<Topics>({
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
			void local.publish(topic as keyof Topics & string, payload as never);
		},
	});
	let disposed = false;

	function subscribe<K extends keyof Topics & string>(
		topic: K,
		subscribeOptions: SubscribeOptions = {},
	): AsyncIterableIterator<Topics[K]> {
		const { signal } = subscribeOptions;
		const inner = local.subscribe(topic, subscribeOptions);
		if (disposed || signal?.aborted) return inner;
		subscriptions.acquire(topic);
		let released = false;
		const leave = (): void => {
			if (released) return;
			released = true;
			signal?.removeEventListener('abort', leave);
			if (!disposed) subscriptions.release(topic);
		};
		signal?.addEventListener('abort', leave, { once: true });
		return releasing(inner, leave);
	}

	return {
		async publish(topic, payload) {
			if (disposed) return;
			await subscriptions.ready();
			await client.publish(prefix + topic, serialize(payload));
		},
		subscribe,
		ready: () => subscriptions.ready(),
		subscriberCount: (topic) => local.subscriberCount(topic),
		async dispose() {
			if (disposed) return;
			disposed = true;
			await local.dispose();
			await subscriptions.close();
			if (owned) closeQuietly(client);
		},
	};
}

/** Wraps `inner` so that finishing, `return()` or `throw()` calls `leave` once. */
function releasing<T>(
	inner: AsyncIterableIterator<T>,
	leave: () => void,
): AsyncIterableIterator<T> {
	return {
		async next() {
			const result = await inner.next();
			if (result.done) leave();
			return result;
		},
		async return() {
			leave();
			return inner.return?.() ?? { done: true, value: undefined };
		},
		async throw(error?: unknown) {
			leave();
			return inner.throw?.(error) ?? Promise.reject(error);
		},
		[Symbol.asyncIterator]() {
			return this;
		},
	};
}
