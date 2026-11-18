import type { RedisClient } from 'bun';
import { closeQuietly } from './connection';

/** The longest `close()` waits for commands still in flight. */
const CLOSE_WAIT_MS = 1000;

/** What {@link createTopicSubscriptions} needs. */
export interface TopicSubscriptionsInit {
	/** The publisher client; its `duplicate()` becomes the subscriber connection. */
	client: RedisClient;
	/** Channel prefix. */
	prefix: string;
	/** Called with the topic (prefix removed) and the raw message. */
	onMessage(topic: string, message: string): void;
	/** Receives connection and command errors. */
	report(error: unknown): void;
}

/** Reference-counted Redis SUBSCRIBEs over one lazily opened connection. */
export interface TopicSubscriptions {
	/** Counts one more local subscriber; the first one sends SUBSCRIBE. */
	acquire(topic: string): void;
	/** Counts one less; the last one sends UNSUBSCRIBE. */
	release(topic: string): void;
	/** Resolves once the commands issued so far are done; never rejects. */
	ready(): Promise<void>;
	/** Closes the subscriber connection; later commands are not sent. */
	close(): Promise<void>;
}

/**
 * Keeps one Redis SUBSCRIBE per topic however many local subscribers it has.
 * Commands run one after the other. Bun reconnects a lost connection by
 * itself but does not restore its subscriptions, and it fires `onconnect`
 * after the first connection too: each `onconnect` subscribes the active
 * topics again (harmless on the server) with a new listener and drops the
 * previous one (Bun keeps every listener of a channel), so delivery stays
 * single and the listener list stays bounded.
 */
export function createTopicSubscriptions(
	init: TopicSubscriptionsInit,
): TopicSubscriptions {
	const { client, prefix, report } = init;
	const refs = new Map<string, number>();
	let subscriber: Promise<RedisClient> | undefined;
	let queue: Promise<void> = Promise.resolve();
	let closed = false;
	let generation = 0;

	const listen = (own: number) => (message: string, channel: string) => {
		if (own === generation)
			init.onMessage(channel.slice(prefix.length), message);
	};
	let listener = listen(generation);

	function connection(): Promise<RedisClient> {
		subscriber ??= client.duplicate().then((redis) => {
			redis.onconnect = () => enqueue(restore);
			redis.onclose = (error) => report(error);
			return redis;
		});
		return subscriber;
	}

	function enqueue(command: (redis: RedisClient) => Promise<unknown>): void {
		queue = queue.then(async () => {
			if (closed) return;
			try {
				await command(await connection());
			} catch (error) {
				report(error);
			}
		});
	}

	async function restore(redis: RedisClient): Promise<void> {
		const previous = listener;
		listener = listen(++generation);
		for (const topic of refs.keys()) {
			await redis.subscribe(prefix + topic, listener);
			// Bun keeps every listener of a channel: drop the inert one.
			await redis.unsubscribe(prefix + topic, previous);
		}
	}

	return {
		acquire(topic) {
			const count = refs.get(topic) ?? 0;
			refs.set(topic, count + 1);
			if (count === 0)
				enqueue((redis) => redis.subscribe(prefix + topic, listener));
		},
		release(topic) {
			const left = (refs.get(topic) ?? 1) - 1;
			if (left > 0) return void refs.set(topic, left);
			refs.delete(topic);
			enqueue((redis) => redis.unsubscribe(prefix + topic));
		},
		ready: () => queue,
		async close() {
			closed = true;
			refs.clear();
			// Bounded: a SUBSCRIBE stuck while the connection is down must not hang dispose.
			const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));
			await Promise.race([queue, wait(CLOSE_WAIT_MS)]);
			const redis = await Promise.race([
				subscriber?.catch(() => undefined),
				wait(CLOSE_WAIT_MS),
			]);
			if (redis) closeQuietly(redis as RedisClient);
		},
	};
}
