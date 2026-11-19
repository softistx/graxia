# @graxia/redis

Redis PubSub, cache and field rate limit for graxia, on [`@softistx/redis`](https://www.npmjs.com/package/@softistx/redis)
(one shared client per URI, one reconnecting subscriber connection, server-timed rate limits) over Bun's built-in
Redis client. No ioredis or node-redis.

## Install

```sh
bun add @graxia/redis @graxia/core @softistx/redis
```

## Requirements

- [Bun](https://bun.sh) 1.4.4 or later (the `engines` field), and a Redis server.
- `@graxia/core` and `@softistx/redis` (`>=0.22.0 <1`) as peer dependencies. `@softistx/redis` also lists `zod` as a peer
  (its channel schemas); install it if your package manager asks, graxia never calls it (until nxgt-data#432).
- With `url`, the client is shared per URI with every other `connectRedis` of your process, which must use the same options for
  that URI; if another module connects it with options, pass its client as `{ client }`.
- `typescript` is an optional peer, for types. Use `"moduleResolution": "bundler"` in your
  `tsconfig.json`; `nodenext` is not supported.

Exports: `redisPubSub`, `redisCache`, `redisFieldLimit` and the types `RedisConnection`, `RedisPubSub`, `RedisPubSubOptions`,
`RedisCacheOptions`, `RedisFieldLimit`, `RedisFieldLimitOptions`.

## PubSub: swap memory for Redis

`redisPubSub` implements the same `PubSub` contract as `createPubSub` (Yoga's shape: `subscribe('post', id)`, `publish('post', id, payload)`), so resolvers
and `pipe` / `filter` / `map` do not change. A topic with an id is the Redis channel `<prefix>topic:id`. Subscribers in other processes receive what you publish.

```ts
import { filter, pipe } from '@graxia/core';
import { redisPubSub } from '@graxia/redis';

type Topics = {
	post: [id: string, payload: { id: string; published: boolean }];
};
const pubsub = redisPubSub<Topics>({ url: process.env.REDIS_URL });

// the Subscription resolver: the engine returns the iterator when the client leaves
const resolvers = {
	Subscription: {
		postPublished: {
			subscribe: () =>
				pipe(
					pubsub.subscribe('post', '42'),
					filter((post) => post.published),
				),
			resolve: (post: { id: string }) => post,
		},
	},
};

await pubsub.publish('post', '42', { id: '42', published: true });
await pubsub.dispose(); // on shutdown
```

Options (all optional):

| Option                      | Default                                    | Meaning                                                                             |
| --------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------- |
| `url`                       | `REDIS_URL`, then `redis://localhost:6379` | Connection; the client is shared per URI (`connectRedis`) and let go on `dispose()` |
| `client`                    |                                            | A `RedisClient` you own instead of `url`; never closed by us                        |
| `prefix`                    | `graxia:`                                  | Prepended to every channel                                                          |
| `bufferSize`                | 1000                                       | Events buffered per subscriber; past it the oldest is dropped                       |
| `onOverflow`                |                                            | Called once per dropped event with `{ topic, dropped }`                             |
| `serialize` / `deserialize` | `JSON.stringify` / `JSON.parse`            | Payload codec                                                                       |
| `onError`                   |                                            | Connection, subscription and payload errors                                         |

## Cache

Options: `url` (`REDIS_URL`, then `redis://localhost:6379`, through `connectRedis`), `client` (as above) and `prefix`
(default `graxia:cache:`, used with exactly one trailing `:`; keys are `<prefix>:<key>`).

`redisCache` implements core's `KeyValueCache<string>`; `createMemoryCache` is its in-process twin. It is also the store of core's automatic persisted
queries: `trustedDocuments: { store: redisCache({ url }) }` shares (`url` is optional: without it Bun's default connection is used) registrations across processes.

```ts
import { redisCache } from '@graxia/redis';

const cache = redisCache({
	url: process.env.REDIS_URL,
	prefix: 'graxia:cache:',
});
await cache.set('greeting', 'hello', { ttlMs: 60_000 }); // SET ... PX 60000
await cache.get('greeting'); // 'hello'
await cache.delete('greeting'); // true when a key was removed
await cache.dispose?.(); // lets go of a shared client it opened; a `client` you passed stays open
```

## Field rate limit

`redisFieldLimit` is a `FieldLimit` for core's `fieldRateLimit` that every process shares: a GCRA bucket on
`@softistx/redis`'s `consumeRateLimit`, timed by the Redis server (no common clock needed).

```ts
import { fieldRateLimit } from '@graxia/core';
import { redisFieldLimit } from '@graxia/redis';

fieldRateLimit({
	fields: {
		search: redisFieldLimit({
			url: process.env.REDIS_URL,
			limit: 30,
			windowMs: 60_000,
		}),
	},
});
```

Options: `limit`, `windowMs` (integers of 1 or more), `burst` (default `limit`), `prefix` (default `graxia:limit:`), `timeoutMs`
(default 1000), `onError`, `url` / `client`. A cost over the burst is refused at once with a `retryAfter` of one window; a cost of 0
spends nothing. A Redis error goes to `onError` and the call is let through (fail open). Unlike `memoryFieldLimit`'s fixed
window, the bucket refills continuously; the guide compares them.

Coming from 0.1? See [Migrating from 0.1](./docs/guide/redis.md#migrating-from-01).

## Delivery guarantees

Redis PubSub is at most once, and graxia adds nothing on top:

- One dedicated subscriber connection (`@softistx/redis`'s `createRawSubscriber`), opened on the first `subscribe()`, carries one
  `SUBSCRIBE` per topic, shared by every local subscriber and dropped with the last.
- `publish()` never rejects: a failing command or `serialize` goes to `onError` and `publish` resolves, so an un-awaited call is safe. A topic without payload (`[]`) publishes and delivers `null`.
- Events published while a connection is down are lost. Iterators stay open across a reconnect
  and receive later events; a connection Bun gives up on is reopened with a backoff (250 ms doubling to 10 s).
- `publish()` and `ready()` wait for this instance's own pending SUBSCRIBEs, so they can wait while
  the subscriber connection is down; `ready()` never rejects, and `dispose()` waits at most one
  second for them.
- Events published by another process just after `subscribe()` returns may arrive before the
  server registered the subscription. `await pubsub.ready()` waits for the `SUBSCRIBE`s issued so
  far. `publish` on the same instance waits for its own pending subscriptions, so a local
  subscribe-then-publish is delivered.
- A payload that fails to deserialize is skipped and reported to `onError`, never thrown into an
  iterator. Errors of the connection also go to `onError`.

## Documentation

See [`docs/`](./docs): the [guide](./docs/guide/redis.md), [troubleshooting](./docs/troubleshooting.md)
and the [roadmap](./docs/roadmap.md).
