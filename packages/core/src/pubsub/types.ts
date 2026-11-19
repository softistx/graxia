/**
 * The topics of a PubSub, as in GraphQL Yoga's `createPubSub`: each topic maps
 * to its publish arguments, `[payload]` or `[id, payload]` (or `[]` for a
 * signal without data).
 */
export type PubSubTopics = Record<
	string,
	[] | [unknown] | [string | number, unknown]
>;

/** The payload type of a topic's publish arguments. */
export type PubSubPayload<Args extends unknown[]> = Args extends [
	unknown,
	infer P,
]
	? P
	: Args extends [infer P]
		? P
		: undefined;

/** The arguments of `subscribe()` for one topic: `[topic]`, or `[topic, id]` when the topic has an id. */
export type PubSubSubscribeArgs<
	Topics extends PubSubTopics,
	K extends keyof Topics & string,
> = Topics[K] extends [] | [unknown]
	? [topic: K]
	: [topic: K, id: Topics[K][0]];

/**
 * A typed publish/subscribe contract, shaped like GraphQL Yoga's `PubSub`.
 * Payloads are plain data so a networked implementation (Redis) honours the
 * same interface. A topic with an id is a channel of its own: `publish('post',
 * 42, p)` reaches `subscribe('post', 42)` only (the channel is `post:42`).
 *
 * The operation's abort signal ends a subscription by itself: the engine
 * returns the iterator a resolver gave when the operation stops, so nothing
 * is passed to `subscribe()`.
 *
 * @example
 * const pubsub = createPubSub<{ post: [id: string, payload: Post]; tick: [payload: number] }>();
 * await pubsub.publish('post', '42', post);
 * for await (const p of pubsub.subscribe('post', '42')) console.log(p);
 */
export interface PubSub<Topics extends PubSubTopics> {
	/** Resolves once the event is queued for every current subscriber, not once they consume it. */
	publish<K extends keyof Topics & string>(
		topic: K,
		...args: Topics[K]
	): Promise<void>;
	/** Registers synchronously: an event published right after this returns is delivered. */
	subscribe<K extends keyof Topics & string>(
		...args: PubSubSubscribeArgs<Topics, K>
	): AsyncIterableIterator<PubSubPayload<Topics[K]>>;
	/** Ends every open iterator; later `subscribe()` returns a finished iterator and `publish()` does nothing. */
	dispose(): Promise<void>;
}

/** The channel of a topic and its optional id: `topic`, or `topic:id`. */
export function channelOf(topic: string, id: string | number | undefined) {
	return id === undefined ? topic : `${topic}:${id}`;
}

/** Splits publish arguments into the id (when there are two) and the payload. */
export function splitPublishArgs(args: readonly unknown[]): {
	id: string | number | undefined;
	payload: unknown;
} {
	return args.length >= 2
		? { id: args[0] as string | number, payload: args[1] }
		: { id: undefined, payload: args[0] };
}
