# Troubleshooting

The errors a consumer can hit, headed by the message as it appears.

## @graxia/redis: pass either "url" or "client", not both

`redisPubSub`, `redisCache` or `redisFieldLimit` received both `url` and `client` (a `GraxiaConfigError`). Pass a `url` and
the adapter owns its connection, or pass your `client` and you own it.

```ts
redisPubSub({ url: process.env.REDIS_URL }); // or
redisPubSub({ client: myRedisClient });
```

## Connection closed (`ERR_REDIS_CONNECTION_CLOSED`)

Redis is unreachable (wrong `url`, server down, connection refused). Bun's `RedisError` (code
`ERR_REDIS_CONNECTION_CLOSED`) says `Connection has failed`, `Connection closed`, or
`Max reconnection attempts reached` once it has retried `maxRetries` times
(default 20). `publish()` and the cache methods reject with it; for `redisPubSub` the same error also
reaches `onError`, since the subscriber connection fails too. Check the `url` (or `REDIS_URL`) and that
the server listens there.

## Subscriptions stop after a Redis outage

Bun reconnects on its own and `redisPubSub` subscribes again; after `maxRetries` (default 20)
Bun gives up and reports through `onclose`; the error reaches your `onError`, and the subscriber
opens a new connection itself after a backoff (250 ms doubling to 10 s) and subscribes again.
Events published while disconnected are lost. Expect a few `onError` calls during a long outage.

## A subscriber misses the first event

Another process published in the short window before Redis registered `SUBSCRIBE`. Await
`pubsub.ready()` before telling publishers to start; on the same instance `publish` already waits.

## @graxia/redis: <uri> is already connected by another module with other options; pass that client as { client }

A `GraxiaConfigError` (its `cause` is `@softistx/redis`'s `RedisError` with code `URI_CONFLICT`: `connectRedis: this URI is already connected with other
options`). `@softistx/redis` shares one client per URI, so `url` adapters (and any other `connectRedis` of your process)
must use the same URI with the same options. `@graxia/redis` passes none: if another module connects the URI with
options (`maxRetries`, `tls`), open the client there and pass it as `client`. The error depends on the order of the
calls: whoever connects second is refused, and that can be your application's own call rather than the adapter's. The
URI's credentials are never in the message.

```ts
import { connectRedis } from '@softistx/redis';

const redis = await connectRedis(url, { maxRetries: 3 });
redisPubSub({ client: redis.client });
```

## @graxia/redis: used after dispose()

An adapter that opened its client from a `url` was used after `dispose()` (a `GraxiaConfigError`). It does not
reconnect on its own: create a new adapter.

```ts
const pubsub = redisPubSub({ url: process.env.REDIS_URL });
await pubsub.dispose();
const next = redisPubSub({ url: process.env.REDIS_URL }); // a new adapter, a new hold on the shared client
```

## @graxia/redis: redisCache prefix must hold at least one character before its ":"

`redisCache({ prefix: '' })` or `prefix: ':'` (a `GraxiaConfigError`): the prefix names the cache, and `@softistx/redis`
builds keys as `<name>:<key>`. Give it a name, `app` or `app:`, or leave it out for `graxia:cache:`.

## @graxia/redis: redisFieldLimit prefix must hold at least one character before its ":"

`redisFieldLimit({ prefix: '' })` or `prefix: ':'` (a `GraxiaConfigError`): every key would start with a bare `:`, and
limits of unrelated features could collide. Give it a name, `app` or `app:`, or leave it out for `graxia:limit:`.

## redisFieldLimit: limit must be an integer of 1 or more

Also `windowMs` and `burst` (a `GraxiaConfigError`, thrown when the limit is created). They are whole numbers of 1 or
more: `limit` units per `windowMs` milliseconds, `burst` (default `limit`) at once.

```ts
redisFieldLimit({ url, limit: 30, windowMs: 60_000 });
```

## redisFieldLimit: burst × windowMs must be at most 9007199254740

The Redis script counts `burst × windowMs` exactly, so the product stays under `Number.MAX_SAFE_INTEGER / 1000`. A
`windowMs` in microseconds or a huge `burst` gets there; lower one of them.

## redisFieldLimit: an empty bucket would take over ten years to refill

`burst × windowMs ÷ limit` is over ten years (a `GraxiaConfigError`). Usually `windowMs` is not in milliseconds (a
duration in seconds multiplied twice, a timestamp), or `limit` is tiny against a large `burst`. Fix the unit or raise `limit`.

## redisFieldLimit: timeoutMs must be an integer of 1 or more

`timeoutMs` (default 1000) is how long one check waits for Redis, connecting included, before it fails open. Pass whole
milliseconds of 1 or more, or leave it out.
