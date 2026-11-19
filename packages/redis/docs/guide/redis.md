# Redis PubSub and cache

## Connections

Both adapters take `{ url }` or `{ client }`, never both (see [troubleshooting](../troubleshooting.md)).

- `url` (default: `REDIS_URL`, then `redis://localhost:6379`): the adapter creates its own
  `RedisClient` and closes it on `dispose()`.
- `client`: your `RedisClient`. The adapter uses it to publish (or for cache commands) and never
  closes it. `redisPubSub` also opens one extra connection with `client.duplicate()` for
  subscriptions, because a subscribed connection cannot run other commands; that one it closes.

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
does not restore its subscriptions. `redisPubSub` subscribes again to every active topic on each
`onconnect`, so open iterators keep receiving. Events published while disconnected are lost: Redis
PubSub is at most once. When Bun gives up (`maxRetries` reached) it calls `onclose`; the error goes to
`onError` and the iterators stay open but silent, so alert on `onError` and restart the instance.

### Waiting while disconnected

`publish()` and `ready()` wait for this instance's own pending SUBSCRIBE/UNSUBSCRIBE commands, so they can
wait while the subscriber connection is down. `ready()` never rejects (failures go to `onError`).
`dispose()` waits at most one second for those commands, so shutdown never hangs.

### Errors

`onError` receives connection errors, failed `SUBSCRIBE` commands and payloads whose `deserialize`
threw (the message is skipped). Nothing is thrown into an iterator. `publish` rejects when Redis
rejects the command or `serialize` throws.

### Shutdown

`await pubsub.dispose()` ends every iterator, closes the subscriber connection (and the client when
it created it) and turns later `publish()` into a no-op and `subscribe()` into a finished iterator.

### Channels and ids

Typed topics are Yoga's: `[payload]` or `[id, payload]`. A topic with an id is the Redis channel
`<prefix>topic:id` (`publish('post', '42', p)` goes to `graxia:post:42`), with one `SUBSCRIBE` per
channel. **Migrating from 0.1:** `subscribe('post:42', { signal })` becomes `subscribe('post', '42')`
(no signal: the engine returns the iterator when the operation stops), and the topic type
`{ [k: `post:${string}`]: Post }` becomes `{ post: [id: string, payload: Post] }`. Channel names on
Redis are unchanged, so old and new processes still talk during a rolling deploy.

## Cache

`redisCache` stores strings under `prefix + key` (default `graxia:cache:`). A `ttlMs` becomes `PX`;
a `set` without one clears a previous expiry. `delete` resolves true when a key was removed.

## Testing against Redis

The package's own Redis specs run when `REDIS_URL` is set and are skipped otherwise:

```sh
docker run -d --rm --name redis-test -p 6379:6379 redis:8-alpine
REDIS_URL=redis://localhost:6379 bun test
docker stop redis-test
```

For application code, use `createPubSub` and `createMemoryCache` in unit tests and Redis in
integration tests; the contracts are the same.
