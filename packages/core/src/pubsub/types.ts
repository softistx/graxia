/** The topics of a PubSub: a map from topic name to payload type. Keys may be template literals. */
export type PubSubTopics = Record<string, unknown>;

/** Options of one `subscribe()` call. */
export interface SubscribeOptions {
	/** Ends the subscription when aborted; an already aborted signal yields a finished iterator. */
	signal?: AbortSignal;
	/** Events buffered for this subscriber before the oldest is dropped. Defaults to the PubSub's `bufferSize` (1000). */
	bufferSize?: number;
}

/**
 * A typed publish/subscribe contract. Payloads are plain data so a networked
 * implementation (Redis) can honour the same interface.
 *
 * @example
 * type Topics = { [k: `post:${string}`]: Post; tick: number };
 * declare const pubsub: PubSub<Topics>;
 * await pubsub.publish('post:42', post);
 * for await (const p of pubsub.subscribe('post:42', { signal })) console.log(p);
 */
export interface PubSub<Topics extends PubSubTopics> {
	/** Resolves once the event is queued for every current subscriber, not once they consume it. */
	publish<K extends keyof Topics & string>(
		topic: K,
		payload: Topics[K],
	): Promise<void>;
	/** Registers synchronously: an event published right after this returns is delivered. */
	subscribe<K extends keyof Topics & string>(
		topic: K,
		options?: SubscribeOptions,
	): AsyncIterableIterator<Topics[K]>;
	/** Ends every open iterator; later `subscribe()` returns a finished iterator and `publish()` does nothing. */
	dispose(): Promise<void>;
}
