# Redis PubSub, cache and field rate limit

## Connections

Both adapters take `{ url }` or `{ client }`, never both (see [troubleshooting](../troubleshooting.md)).

- `url` (default: `REDIS_URL`, then `redis://localhost:6379`): the adapter calls `@softistx/redis`'s `connectRedis`
  on first use, so every adapter (and every other module of your process) on the same URI shares **one**
  `RedisClient`; `dispose()` lets go of it and the client closes with the last holder. A connect that fails is
  retried by the next call.
- `client`: your `RedisClient`. The adapter uses it to publish (or for cache commands) and never
  closes it. `redisPubSub` also opens one extra connection for subscriptions (`createRawSubscriber` duplicates
  the client), because a subscribed connection cannot run other commands; that one it closes.

`@softistx/redis` is a peer dependency: install it (`bun add @softistx/redis`, `^0.22.0`).

## PubSub

```ts
import { createGraxia, createSchema } from '@graxia/core';
import { redisPubSub } from '@graxia/redis';

const pubsub = redisPubSub<{ tick: [payload: number] }>({
	url: process.env.REDIS_URL,
	onError: (error) => console.error('redis', error),
});

const schema = createSchema<{ signal: AbortSignal }>()({
	typeDefs: 'type Query { ok: Boolean } type Subscription { tick: Int! }',
	resolvers: {
		Query: { ok: () => true },
		Subscription: {
			tick: {
				subscribe: () => pubsub.subscribe('tick'),
				resolve: (n: number) => n,
			},
		},
	},
});
const graxia = createGraxia({ schema });
```

Any process using the same Redis and `prefix` can call `pubsub.publish('tick', 1)`; every
subscription on every instance receives it.

### Subscribing is shared

The first local subscriber of a topic sends `SUBSCRIBE <prefix><topic>`; further local subscribers
reuse it; the last one leaving (an abort, `return()`, a `break`) sends `UNSUBSCRIBE`. Topics that are
template literals work, since they are concrete strings at runtime.

### When is a subscription live?

`subscribe()` returns at once, before Redis acknowledges. Two consequences:

- On the same instance, `publish` waits for pending `SUBSCRIBE`s, so subscribe-then-publish is
  delivered, as with the memory PubSub.
- An event another process publishes in that window can be missed. `await pubsub.ready()` resolves
  once the commands issued so far are done; call it before signalling that events may flow, or in
  tests.

### Reconnect

Bun reconnects a lost connection on its own (`autoReconnect`, up to `maxRetries`, default 20) but
does not restore its subscriptions. The raw subscriber subscribes again to every active topic on each
`onconnect`, so open iterators keep receiving, once per message. Events published while disconnected are
lost: Redis PubSub is at most once. When Bun gives up (`maxRetries` reached), or Redis was down at the first
`subscribe()`, the subscriber opens a new connection itself after a backoff (250 ms doubling to 10 s) and
subscribes again; the error goes to `onError`. No restart is needed.

### Waiting while disconnected

`publish()` and `ready()` wait for this instance's own pending SUBSCRIBE/UNSUBSCRIBE commands, so they can
wait while the subscriber connection is down. `ready()` never rejects (failures go to `onError`).
`dispose()` waits at most one second for those commands, so shutdown never hangs.

### Errors

`onError` receives connection errors, failed `SUBSCRIBE` commands and payloads whose `deserialize`
threw (the message is skipped). Nothing is thrown into an iterator. `publish` never rejects: when
Redis rejects the command or `serialize` throws, the error goes to `onError` and `publish` resolves,
so an un-awaited `publish(...)`, as in Yoga, is safe.

### Shutdown

`await pubsub.dispose()` ends every iterator, closes the subscriber connection (and the client when
it created it) and turns later `publish()` into a no-op and `subscribe()` into a finished iterator.

### Channels and ids

Typed topics are Yoga's: `[payload]` or `[id, payload]`. A topic with an id is the Redis channel
`<prefix>topic:id` (`publish('post', '42', p)` goes to `graxia:post:42`), with one `SUBSCRIBE` per
channel. **Migrating from 0.1:** `subscribe('post:42', { signal })` becomes `subscribe('post', '42')`
(no signal: the engine returns the iterator when the operation stops), and the topic type
``{ [k: `post:${string}`]: Post }`` becomes `{ post: [id: string, payload: Post] }`. Channel names on
Redis are unchanged, so old and new processes still talk during a rolling deploy.

## Cache

`redisCache` is a `@softistx/redis` raw cache: it stores strings under `<prefix>:<key>` (default prefix
`graxia:cache:`; a trailing `:` on `prefix` is optional). A `ttlMs` becomes `PX`;
a `set` without one clears a previous expiry. `delete` resolves true when a key was removed.

## Field rate limit

`redisFieldLimit({ limit, windowMs, burst?, prefix?, url? | client? })` is a core `FieldLimit` for `fieldRateLimit`,
on `consumeRateLimit` (GCRA, timed by the Redis server). All processes on one Redis share the counters. A field with
cost `n` spends `n` units at once; a cost over `burst` is refused immediately with `retryAfter` of one window. Keys are
`<prefix>:<key>`. `await limit.dispose()` lets go of a shared client it opened.

## Migrating from 0.1

- Install the peer: `bun add @softistx/redis`.
- A `prefix` for `redisCache` without a trailing `:` (`'app'`) now stores `app:<key>` (it stored `app<key>`); give the
  old string a trailing `:` to keep the keys you have.
- With `url`, adapters of one URI now share one client instead of one each, and `connectRedis` options apply
  process-wide (the same URI must be connected with the same options everywhere).
- Nothing else changes: `redisPubSub`, `redisCache` and their options, returns and wire formats are the same.

## Testing against Redis

The package's own Redis specs run when `REDIS_URL` is set and are skipped otherwise:

```sh
docker run -d --rm --name redis-test -p 6379:6379 redis:8-alpine
REDIS_URL=redis://localhost:6379 bun test
docker stop redis-test
```

For application code, use `createPubSub` and `createMemoryCache` in unit tests and Redis in
integration tests; the contracts are the same.
