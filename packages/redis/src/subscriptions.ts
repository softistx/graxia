import {
	createRawSubscriber,
	type RawSubscriber,
	type Subscription,
} from '@softistx/redis';
import type { RedisClient } from 'bun';

/** The longest `close()` waits for commands still in flight. */
const CLOSE_WAIT_MS = 1000;

/** What {@link createTopicSubscriptions} needs. */
export interface TopicSubscriptionsInit {
	/** The publisher client; its `duplicate()` becomes the subscriber connection. */
	client(): Promise<RedisClient>;
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
 * Keeps one Redis SUBSCRIBE per topic however many local subscribers it has,
 * on a `@softistx/redis` raw subscriber: one shared subscriber connection,
 * reopened with a backoff and subscribed again after a drop, with single
 * delivery. Commands run one after the other.
 */
export function createTopicSubscriptions(
	init: TopicSubscriptionsInit,
): TopicSubscriptions {
	const { prefix, report } = init;
	const refs = new Map<string, number>();
	const open = new Map<string, Subscription>();
	let subscriber: Promise<RawSubscriber> | undefined;
	let queue: Promise<void> = Promise.resolve();
	let closed = false;

	function connection(): Promise<RawSubscriber> {
		subscriber ??= init
			.client()
			.then((client) =>
				createRawSubscriber(client, { onError: (error) => report(error) }),
			);
		const pending = subscriber;
		pending.catch(() => {
			if (subscriber === pending) subscriber = undefined;
		});
		return pending;
	}

	function enqueue(command: (raw: RawSubscriber) => Promise<unknown>): void {
		queue = queue.then(async () => {
			if (closed) return;
			try {
				await command(await connection());
			} catch (error) {
				report(error);
			}
		});
	}

	return {
		acquire(topic) {
			const count = refs.get(topic) ?? 0;
			refs.set(topic, count + 1);
			if (count > 0) return;
			enqueue(async (raw) => {
				open.set(
					topic,
					raw.subscribe(prefix + topic, (message) =>
						init.onMessage(topic, message),
					),
				);
			});
		},
		release(topic) {
			const left = (refs.get(topic) ?? 1) - 1;
			if (left > 0) return void refs.set(topic, left);
			refs.delete(topic);
			enqueue(async () => {
				const subscription = open.get(topic);
				open.delete(topic);
				await subscription?.close();
			});
		},
		ready: async () => {
			await queue;
			await (await subscriber?.catch(() => undefined))?.ready();
		},
		async close() {
			closed = true;
			refs.clear();
			// Bounded: a SUBSCRIBE stuck while the connection is down must not hang dispose.
			const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));
			await Promise.race([queue, wait(CLOSE_WAIT_MS)]);
			const raw = await Promise.race([
				subscriber?.catch(() => undefined),
				wait(CLOSE_WAIT_MS),
			]);
			await (raw as RawSubscriber | undefined)?.close();
		},
	};
}
