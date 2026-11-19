# PubSub

`createPubSub` is a typed publish/subscribe for subscription resolvers, with the same shape as
GraphQL Yoga's `createPubSub`: the same topic typing, the same `subscribe(topic, id?)` and
`publish(topic, id?, payload)`, and the same `pipe`, `filter` and `map` helpers. [Subscriptions
over SSE](./subscriptions.md) and the [WebSocket transport](./websocket.md) deliver its events to
clients.

## Typed topics

A topic map gives each topic its publish arguments: `[payload]`, or `[id, payload]` for a topic
scoped by an id (a post, a room, a user). `[]` is a signal without data.

```ts
import { createPubSub } from '@graxia/core';

type Post = { id: string; published: boolean };
const pubsub = createPubSub<{
	post: [id: string, payload: Post];
	tick: [payload: number];
}>();

await pubsub.publish('post', '42', { id: '42', published: true }); // checked against Post
await pubsub.publish('tick', 'x'); // type error
```

Payloads should be plain data, so a networked implementation can carry them. A topic with an id
is one channel per id (`post:42`): `publish('post', '42', p)` reaches `subscribe('post', '42')`
and nobody else.

## Subscribe

`subscribe` returns an `AsyncIterableIterator` of the topic's payload type, so a resolver needs
no hand-written annotation. It registers synchronously: an event published right after
`subscribe()` returns, before the first `next()`, is delivered. `publish` resolves once the
event is queued for every current subscriber, not once they consume it. Order is kept per
subscriber.

```ts
const resolvers = {
	Subscription: {
		post: {
			subscribe: (_: unknown, { id }: { id: string }) =>
				pubsub.subscribe('post', id),
			resolve: (post: Post) => post,
		},
	},
};
```

## Pipe, filter and map

`pipe(source, ...operators)` applies `filter` and `map` operators from left to right. Each
forwards `return()` to the source, so a filtered subscription unsubscribes when the client goes
away. A throw in a predicate or a mapper returns the source, then rejects. A type guard narrows
the element type.

```ts
import { filter, map, pipe } from '@graxia/core';

subscribe: (_: unknown, { id }: { id: string }) =>
	pipe(
		pubsub.subscribe('post', id),
		filter((p) => p.published),
		map((p) => ({ ...p, title: p.id })),
	);
```

## Cancellation

Nothing is passed to `subscribe()`. When the operation stops (the client sends `complete`,
disconnects, or the request's `signal` aborts, or the server shuts down), the engine returns the
iterator your resolver gave: a pending `next()` resolves `{ done: true }` and the subscriber is
removed. `return()`, `throw()` and a `break` in `for await` do the same; events still buffered
are discarded, so a later `next()` returns `{ done: true }`.

`pubsub.subscriberCount(topic, id?)` (memory implementation only) reports open subscriptions,
which is handy in tests.

## Buffer and overflow

Each subscriber has a buffer, 1000 events by default (`bufferSize` on `createPubSub`; a value that
is not a finite number of at least 1 falls back to the default). When it is full the oldest event
is dropped and `onOverflow({ topic, dropped })` is called once per drop. A slow subscriber never
blocks or rejects `publish`, and an `onOverflow` that throws is ignored.

```ts
const pubsub = createPubSub<Topics>({
	bufferSize: 100,
	onOverflow: ({ topic }) => console.warn(`dropped an event on ${topic}`),
});
```

## Coming from Yoga or Apollo

| You write                                                            | In graxia                                                             |
| -------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Yoga `createPubSub<{ post: [id: string, payload: Post] }>()`         | the same line, imported from `@graxia/core`                           |
| Yoga `pubsub.subscribe('post', id)`, `publish('post', id, p)`        | identical                                                             |
| Yoga `pipe`, `filter`, `map` (`graphql-yoga`)                        | identical, from `@graxia/core`                                        |
| Apollo `graphql-subscriptions` `pubsub.asyncIterableIterator(['A'])` | `pubsub.subscribe('A')`                                               |
| Apollo `pubsub.publish('A', { a: payload })`                         | `pubsub.publish('A', payload)`, the payload is not wrapped in a field |

Two differences from Yoga: `publish` returns a promise (so a Redis implementation can await the
network), and `createPubSub` takes `bufferSize` and `onOverflow` instead of an `eventTarget`.

## Migrating from 0.3

| 0.3                                                 | 0.4                                            |
| --------------------------------------------------- | ---------------------------------------------- |
| `createMemoryPubSub<{ tick: number }>()`            | `createPubSub<{ tick: [payload: number] }>()`  |
| `{ [k: \`post:${string}\`]: Post }`                 | `{ post: [id: string, payload: Post] }`        |
| `subscribe(\`post:${id}\`, { signal: ctx.signal })` | `subscribe('post', id)`                        |
| `publish(\`post:${id}\`, post)`                     | `publish('post', id, post)`                    |
| `filterIterable(src, fn)` / `mapIterable(src, fn)`  | `pipe(src, filter(fn))` / `pipe(src, map(fn))` |
| `subscribe(topic, { bufferSize })`                  | `createPubSub({ bufferSize })` (per PubSub)    |
| `subscriberCount('post:42')`                        | `subscriberCount('post', '42')`                |

`filterIterable`, `mapIterable`, `createMemoryPubSub` and `SubscribeOptions` are removed.

## Several processes

The memory PubSub only reaches subscribers in the same process. For several instances, swap it
for `redisPubSub` from [`@graxia/redis`](https://www.npmjs.com/package/@graxia/redis): it implements the same `PubSub`
interface on Bun's Redis client (a topic with an id is the channel `topic:id`), so resolvers do not change.

```ts
import { redisPubSub } from '@graxia/redis';

const pubsub = redisPubSub<Topics>({ url: process.env.REDIS_URL });
```

## Shutdown

`await pubsub.dispose()` ends every open iterator, makes later `subscribe()` calls return a
finished iterator and turns `publish()` into a no-op.
