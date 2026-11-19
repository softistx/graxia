# Redis PubSub, cache and field rate limit

## Connections

Both adapters take `{ url }` or `{ client }`, never both (see [troubleshooting](../troubleshooting.md)).

- `url` (default: `REDIS_URL`, then `redis://localhost:6379`): the adapter calls `@softistx/redis`'s `connectRedis`
  on first use, so every adapter (and every other module of your process) on the same URI shares **one**
  `RedisClient`; `dispose()` lets go of the shared client (it closes with its last holder), and any later use of the adapter
  rejects with `used after dispose()`. A connect that fails is
  retried by the next call.
- `client`: your `RedisClient`. The adapter uses it to publish (or for cache commands) and never
  closes it. `redisPubSub` also opens one extra connection for subscriptions (`createRawSubscriber` duplicates
  the client), because a subscribed connection cannot run other commands; that one it closes.

`@softistx/redis` is a peer dependency: install it (`bun add @softistx/redis`, range `>=0.22.0 <1`).

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
subscribes again; the error goes to `onError`. Subscriptions need no restart.

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

`await pubsub.dispose()` ends every iterator, closes the subscriber connection (and lets go of the shared client
when it opened it; it closes with its last holder) and turns later `publish()` into a no-op and `subscribe()` into a finished iterator.

### Channels and ids

Typed topics are Yoga's: `[payload]` or `[id, payload]`. A topic with an id is the Redis channel
`<prefix>topic:id` (`publish('post', '42', p)` goes to `graxia:post:42`), with one `SUBSCRIBE` per
channel. Coming from 0.1, see [Migrating from 0.1](#migrating-from-01).

## Cache

`redisCache` is a `@softistx/redis` raw cache: it stores strings under `graxia:cache:<key>` by default. A prefix is used with exactly one trailing `:`
(`app` and `app:` both give `app:<key>`) and needs at least one character before it. A `ttlMs` becomes `PX`;
a `set` without one clears a previous expiry. `delete` resolves true when a key was removed.

## Field rate limit

`redisFieldLimit({ limit, windowMs, burst?, prefix?, url? | client? })` is a core `FieldLimit` for `fieldRateLimit`,
on `consumeRateLimit` (GCRA, timed by the Redis server). All processes on one Redis share the counters. A field with
cost `n` spends `n` units at once; a cost over `burst` is refused immediately with `retryAfter` of one window. Keys are
`<prefix>:<key>`. `await limit.dispose()` lets go of the shared client it opened (it closes with its last holder); the
limit then rejects with `used after dispose()`.

Options: `limit`, `windowMs`, `burst` (default `limit`), `prefix` (default `graxia:limit:`), `timeoutMs` (default 1000,
how long one check waits for Redis), `onError`, `url` / `client`. `limit`, `windowMs`, `burst` and `timeoutMs` are
integers of 1 or more; `burst × windowMs` must be at most 9 007 199 254 740 and an empty bucket must refill in under ten
years (`burst × windowMs ÷ limit`), else a `GraxiaConfigError`.

**Redis outage: fail open.** A Redis error (down, timeout) goes to `onError` (nothing is logged without it) and the call is
let through, so a limit never takes the API down with Redis. Misuse (`used after dispose()`, a URI connected with other
options) is not an outage and still rejects.

### `redisFieldLimit` and `memoryFieldLimit`

|                             | `memoryFieldLimit`                     | `redisFieldLimit`                                                                              |
| --------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Shared by processes         | no, one process                        | yes, one Redis                                                                                 |
| Algorithm                   | fixed window                           | GCRA bucket, timed by the Redis server                                                         |
| Refill                      | the whole window at once, when it ends | one unit per `windowMs / limit`, continuously                                                  |
| Burst                       | `limit` per window                     | `burst` (default `limit`) at once; with the default, up to about 2 × `limit` within one window |
| `retryAfter`                | time until the window resets           | time until this call would be allowed                                                          |
| Cost 0                      | spends nothing, allowed                | spends nothing, allowed (no Redis call)                                                        |
| Cost over the limit / burst | refused (`retryAfter` of one window)   | refused (`retryAfter` of one window)                                                           |
| Backend outage              | n/a                                    | fail open, reported to `onError`                                                               |

## Migrating from 0.1

0.2 has four breaks:

1. **Topics.** `subscribe('post:42', { signal })` becomes `subscribe('post', '42')` (no signal: the engine returns the
   iterator when the operation stops), and the topic type ``{ [k: `post:${string}`]: Post }`` becomes
   `{ post: [id: string, payload: Post] }`; this follows core's Yoga-shaped PubSub. Channel names on Redis are unchanged,
   so old and new processes still talk during a rolling deploy.
2. **Peer.** Install `@softistx/redis` (`bun add @softistx/redis`, range `>=0.22.0 <1`).
3. **Cache prefix.** A prefix is used with exactly one trailing `:`. A prefix that does not end in `:` writes new keys
   (`app:<key>` instead of `app<key>`); entries written by 0.1 are no longer read and expire or can be deleted. A prefix
   that already ends in `:` (the default `graxia:cache:`) keeps its keys. A prefix with no character before its `:`
   (`''` or `':'`) throws a `GraxiaConfigError`.
4. **Shared client.** With `url`, every adapter of one URI shares one client, and `connectRedis` options apply
   process-wide: the same URI must be connected with the same options everywhere (see
   [troubleshooting](../troubleshooting.md)).

`redisPubSub`, `redisCache`, their other options, return types and wire formats are the same.

## Testing against Redis

The package's own Redis specs run when `REDIS_URL` is set and are skipped otherwise:

```sh
docker run -d --rm --name redis-test -p 6379:6379 redis:8-alpine
REDIS_URL=redis://localhost:6379 bun test
docker stop redis-test
```

For application code, use `createPubSub` and `createMemoryCache` in unit tests and Redis in
integration tests; the contracts are the same.
