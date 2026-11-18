# PubSub

`createMemoryPubSub` is a typed publish/subscribe for subscription resolvers. This release ships
the PubSub and its helpers; the transports that deliver subscriptions to clients (SSE, WebSocket)
arrive in a later release.

## Typed topics

A topic map gives each topic its payload type. Keys may be template literals.

```ts
import { createMemoryPubSub } from '@graxia/core';

type Post = { id: string; published: boolean };
type Topics = { [k: `post:${string}`]: Post; tick: number };
const pubsub = createMemoryPubSub<Topics>();

await pubsub.publish('post:42', { id: '42', published: true }); // checked against Post
await pubsub.publish('tick', 'x'); // type error
```

Payloads should be plain data, so a networked implementation can carry them.

## Subscribe

`subscribe` returns an `AsyncIterableIterator`. It registers synchronously: an event published
right after `subscribe()` returns, before the first `next()`, is delivered. `publish` resolves
once the event is queued for every current subscriber, not once they consume it. Order is kept
per subscriber.

```ts
const controller = new AbortController();
for await (const post of pubsub.subscribe('post:42', {
	signal: controller.signal,
})) {
	console.log(post.id);
}
```

## Filter and map

`filterIterable` and `mapIterable` wrap any async iterable. Both forward `return()` to the source,
so a filtered subscription unsubscribes when the client goes away. A throw in the predicate or the
mapper returns the source, then rejects. A type guard narrows the element type.

```ts
import { filterIterable } from '@graxia/core';

const resolvers = {
	Subscription: {
		post: {
			subscribe: (
				_: unknown,
				{ id }: { id: string },
				ctx: { signal: AbortSignal },
			) =>
				filterIterable(
					pubsub.subscribe(`post:${id}`, { signal: ctx.signal }),
					(p) => p.published,
				),
		},
	},
};
```

## Cancellation

Pass the request's `signal` to `subscribe`. When it aborts, a pending `next()` resolves
`{ done: true }` and the subscriber is removed. An already aborted signal gives a finished
iterator and registers nothing. `return()`, `throw()` and a `break` in `for await` also remove
the subscriber, and no listener is left on the signal. Abort, `return()` and `dispose()` stop
at once: events still buffered are discarded, so a later `next()` returns `{ done: true }`.

`pubsub.subscriberCount(topic)` (memory implementation only) reports open subscriptions, which is
handy in tests.

## Buffer and overflow

Each subscriber has a buffer, 1000 events by default (`bufferSize` on `createMemoryPubSub` or per
`subscribe`; a value that is not a finite number of at least 1 falls back to the default). When it is full the oldest event is dropped and `onOverflow({ topic, dropped })` is
called once per drop. A slow subscriber never blocks or rejects `publish`, and an `onOverflow` that throws is ignored.

```ts
const pubsub = createMemoryPubSub<Topics>({
	bufferSize: 100,
	onOverflow: ({ topic }) => console.warn(`dropped an event on ${topic}`),
});
```

## Single process

The memory PubSub only reaches subscribers in the same process. A Redis implementation of the same
`PubSub` interface is planned for multi-instance deployments.

## Shutdown

`await pubsub.dispose()` ends every open iterator, makes later `subscribe()` calls return a
finished iterator and turns `publish()` into a no-op.
