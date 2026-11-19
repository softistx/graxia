# Roadmap

Where `@graxia/redis` is going, as what you get. A direction, not a commitment.

## Next

- Redis Streams based delivery for at-least-once subscriptions, if there is demand.

## Later

- Redis Cluster and sharded PubSub (`SSUBSCRIBE`).

## Not planned

- ioredis or node-redis adapters; the package is Bun only.

## Shipped

### 0.2.0

- **On `@softistx/redis`** — PubSub, cache and connection run on the in-house package: one shared client per URI,
  one reconnecting subscriber connection (backoff, no double delivery, no restart of the subscriptions after Bun gives up).
- **Yoga-shaped topics** — `subscribe('post', id)` / `publish('post', id, payload)` follow core's PubSub.
- **`redisFieldLimit`** — a Redis-backed limit for `fieldRateLimit`, shared by every process and timed by the server;
  fails open on a Redis outage. See [the guide](./guide/redis.md).
- Breaking changes: see [Migrating from 0.1](./guide/redis.md#migrating-from-01).

### 0.1.0

- **Redis PubSub and cache** — `redisPubSub` (drop-in for core's memory PubSub, resubscribes after a
  reconnect) and `redisCache` (TTL with `PX`) on Bun's built-in Redis client. See [the guide](./guide/redis.md).
