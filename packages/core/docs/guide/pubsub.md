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
import { createPubSub } from '@softistx/graxia';

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
import { filter, map, pipe } from '@softistx/graxia';

subscribe: (_: unknown, { id }: { id: string }) =>
	pipe(
		pubsub.subscribe('post', id),
		filter((p) => p.published),
		map((p) => ({ ...p, title: p.id })),
	);
```

## Cancellation

Nothing is passed to `subscribe()`. Called inside an operation, it reads the operation's `signal`
from the operation context (so `asyncContext`, on by default, must stay on). **Guarantee:** when
the operation stops (the client sends `complete`, disconnects, the request's `signal` aborts, or
the server shuts down), the subscriber is removed at once, whether or not a `next()` is pending
and whatever the resolver does with the iterator: an `async function*` that relays
`for await (const x of pubsub.subscribe('t')) yield x` no longer keeps its subscriber until the
next publish. An already aborted signal gives a finished iterator and registers nothing. The
engine also returns the iterator your resolver gave; `return()`, `throw()` and a `break` in
`for await` remove the subscriber too. Events still buffered are discarded, so a later `next()`
returns `{ done: true }`. With `asyncContext: false`, `subscribe()` cannot see the signal: return the iterator directly or through `pipe`, since an `async function*` relay keeps its subscriber until the next event. Outside an operation (a unit test), end it with `return()`.

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
| Yoga `createPubSub<{ post: [id: string, payload: Post] }>()`         | the same line, from `@softistx/graxia` (options differ, see below)    |
| Yoga `pubsub.subscribe('post', id)`, `publish('post', id, p)`        | same names, arguments and typing                                      |
| Yoga `pipe`, `filter`, `map` (`graphql-yoga`)                        | same names and typing, from `@softistx/graxia`                        |
| Apollo `graphql-subscriptions` `pubsub.asyncIterableIterator(['A'])` | `pubsub.subscribe('A')`                                               |
| Apollo `pubsub.publish('A', { a: payload })`                         | `pubsub.publish('A', payload)`, the payload is not wrapped in a field |

The same shape, not the same package. The real differences from Yoga:

- **Options.** `createPubSub({ bufferSize, onOverflow })` replaces Yoga's `eventTarget` and
  `repeaterBuffer`.
- **Buffer.** A slow subscriber's buffer slides (the oldest event is dropped, 1000 by default,
  `onOverflow` called); Yoga's overflows with a `RepeaterOverflowError` at 1024.
- **No Repeater re-exports.** `Repeater`, `FixedBuffer` and friends are not re-exported: use
  `@repeaterjs/repeater` if you need them. `subscribe` returns a `PubSubIterator` (an async
  iterator whose `return()` and `throw()` are always typed).
- **`publish` returns a Promise that never rejects** (a Redis failure goes to `onError`), so an
  un-awaited `publish(...)` is safe, as in Yoga.
- **Payload of a topic without data.** `[]` topics deliver `null`, as Yoga's.
- **Abort.** The operation's signal ends the subscriber by itself; Yoga relies on the executor
  calling `return()`.

## Migrating from 0.3

| 0.3                                                 | 0.4                                            |
| --------------------------------------------------- | ---------------------------------------------- |
| `createMemoryPubSub<{ tick: number }>()`            | `createPubSub<{ tick: [payload: number] }>()`  |
| ``{ [k: `post:${string}`]: Post }``                 | `{ post: [id: string, payload: Post] }`        |
| ``subscribe(`post:${id}`, { signal: ctx.signal })`` | `subscribe('post', id)`                        |
| ``publish(`post:${id}`, post)``                     | `publish('post', id, post)`                    |
| `filterIterable(src, fn)` / `mapIterable(src, fn)`  | `pipe(src, filter(fn))` / `pipe(src, map(fn))` |
| `subscribe(topic, { bufferSize })`                  | `createPubSub({ bufferSize })` (per PubSub)    |
| `subscriberCount('post:42')`                        | `subscriberCount('post', '42')`                |

`filterIterable`, `mapIterable`, `createMemoryPubSub` and `SubscribeOptions` are removed.

## Several processes

The memory PubSub only reaches subscribers in the same process. For several instances, swap it
for `redisPubSub` from [`@softistx/graxia-redis`](https://www.npmjs.com/package/@softistx/graxia-redis): it implements the same `PubSub`
interface on `@softistx/redis` (a topic with an id is the channel `topic:id`), so resolvers do not change.

```ts
import { redisPubSub } from '@softistx/graxia-redis';

const pubsub = redisPubSub<Topics>({ url: process.env.REDIS_URL });
```

## Shutdown

`await pubsub.dispose()` ends every open iterator, makes later `subscribe()` calls return a
finished iterator and turns `publish()` into a no-op.
