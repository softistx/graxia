# @graxia/redis

## 0.2.1

### Patch Changes

- Updated dependencies [[`6ec2589`](https://github.com/softistx/graxia/commit/6ec2589e1de9241b8d6fc52de73a66ef629bd0e1), [`6ec2589`](https://github.com/softistx/graxia/commit/6ec2589e1de9241b8d6fc52de73a66ef629bd0e1)]:
  - @graxia/core@0.5.0

## 0.2.0

### Minor Changes

- [#84](https://github.com/softistx/graxia/pull/84) [`ce91d85`](https://github.com/softistx/graxia/commit/ce91d850a918083960a2e40d0297652003312fa9) Thanks [@SteveGT96](https://github.com/SteveGT96)! - BREAKING (pre-1.0): `@graxia/redis` runs on `@softistx/redis` instead of Bun's `RedisClient` alone. `@softistx/redis` (`^0.24.0`) becomes a peer dependency, and it needs `zod` (its type declarations import it): `bun add @softistx/redis zod`. PubSub uses one shared, reconnecting subscriber connection (reopened with a backoff when Bun gives up, no double delivery), the cache is a raw cache, and a `url` is connected through `connectRedis`, so adapters of one URI share one client (the same URI must be connected with the same options everywhere; another module's options give a `GraxiaConfigError` telling you to pass `{ client }`). A use after `dispose()` rejects. The topic signature change is in its own changeset (`yoga-pubsub-redis`); channel names and cache and payload formats on Redis are unchanged, and `redisPubSub` and `redisCache` keep their other options.

  Cache prefix: it is used with exactly one trailing `:`. A prefix that does not end in `:` writes new keys (`app:<key>` instead of `app<key>`); entries written by 0.1 are no longer read and expire or can be deleted. A prefix that already ends in `:` (the default) keeps its keys. A prefix with no character before its `:` (`''` or `':'`) throws a `GraxiaConfigError`.

  New `redisFieldLimit({ limit, windowMs, burst?, prefix?, timeoutMs?, onError?, url? | client? })`: a core `FieldLimit` for `fieldRateLimit` shared by every process (server-timed GCRA bucket). On a Redis error it calls `onError` and lets the call through (fail open). See the guide's migration notes.

  The peer range is `^0.24.0` (a 0.x minor is a breaking step, so it is no longer open-ended). `redisFieldLimit` now refuses an empty `prefix` (`''` or `':'`) with a `GraxiaConfigError`, like `redisCache`. The `redisPubSub` `prefix` stays verbatim (pass `'app:'`, not `'app'`).

- [#84](https://github.com/softistx/graxia/pull/84) [`ce91d85`](https://github.com/softistx/graxia/commit/ce91d850a918083960a2e40d0297652003312fa9) Thanks [@SteveGT96](https://github.com/SteveGT96)! - BREAKING (pre-1.0): `redisPubSub` follows `@graxia/core`'s PubSub in Yoga's shape (needs the matching core minor): tuple topics, `subscribe(topic, id?)`, `publish(topic, id?, payload)`, no `{ signal }` argument (the iterator is returned when the operation stops). A topic with an id is the Redis channel `<prefix>topic:id`, unchanged on the wire. `subscriberCount(topic, id?)` takes the id. Migration: `subscribe('post:42', { signal })` → `subscribe('post', '42')`, and the topic type ``{ [k: `post:${string}`]: Post }`` → `{ post: [id: string, payload: Post] }`.

  `publish` never rejects: a failing command goes to `onError`. A topic without payload delivers `null`.

### Patch Changes

- Updated dependencies [[`ce91d85`](https://github.com/softistx/graxia/commit/ce91d850a918083960a2e40d0297652003312fa9), [`ce91d85`](https://github.com/softistx/graxia/commit/ce91d850a918083960a2e40d0297652003312fa9), [`ce91d85`](https://github.com/softistx/graxia/commit/ce91d850a918083960a2e40d0297652003312fa9), [`ce91d85`](https://github.com/softistx/graxia/commit/ce91d850a918083960a2e40d0297652003312fa9), [`7731216`](https://github.com/softistx/graxia/commit/7731216aa371de460c0360a461902363d1586681), [`ce91d85`](https://github.com/softistx/graxia/commit/ce91d850a918083960a2e40d0297652003312fa9), [`ce91d85`](https://github.com/softistx/graxia/commit/ce91d850a918083960a2e40d0297652003312fa9)]:
  - @graxia/core@0.4.0

## 0.1.1

### Patch Changes

- [#63](https://github.com/softistx/graxia/pull/63) [`bf5497c`](https://github.com/softistx/graxia/commit/bf5497c71e62bc37a48cb3ae48f37bd973e2e499) Thanks [@SteveGT96](https://github.com/SteveGT96)! - docs: README names redisCache as the store of core's automatic persisted queries
- Updated dependencies [[`bf5497c`](https://github.com/softistx/graxia/commit/bf5497c71e62bc37a48cb3ae48f37bd973e2e499), [`5c22fdd`](https://github.com/softistx/graxia/commit/5c22fdde87b81a6fff3074b61020b08df3b01c5c), [`bf5497c`](https://github.com/softistx/graxia/commit/bf5497c71e62bc37a48cb3ae48f37bd973e2e499), [`bf5497c`](https://github.com/softistx/graxia/commit/bf5497c71e62bc37a48cb3ae48f37bd973e2e499), [`bf5497c`](https://github.com/softistx/graxia/commit/bf5497c71e62bc37a48cb3ae48f37bd973e2e499), [`bf5497c`](https://github.com/softistx/graxia/commit/bf5497c71e62bc37a48cb3ae48f37bd973e2e499), [`bf5497c`](https://github.com/softistx/graxia/commit/bf5497c71e62bc37a48cb3ae48f37bd973e2e499)]:
  - @graxia/core@0.3.0

## 0.1.0

### Minor Changes

- [#52](https://github.com/softistx/graxia/pull/52) [`a5511e7`](https://github.com/softistx/graxia/commit/a5511e7c865f0c89728ff032ad84b871d3f7554e) Thanks [@SteveGT96](https://github.com/SteveGT96)! - Redis PubSub and cache on Bun's Redis client: `redisPubSub` (the `PubSub` contract across processes, one shared SUBSCRIBE per topic, resubscribe on reconnect, `ready()`) and `redisCache` (the `KeyValueCache` contract with `PX` expiry).

### Patch Changes

- Updated dependencies [[`a5511e7`](https://github.com/softistx/graxia/commit/a5511e7c865f0c89728ff032ad84b871d3f7554e), [`a5511e7`](https://github.com/softistx/graxia/commit/a5511e7c865f0c89728ff032ad84b871d3f7554e), [`a5511e7`](https://github.com/softistx/graxia/commit/a5511e7c865f0c89728ff032ad84b871d3f7554e), [`a5511e7`](https://github.com/softistx/graxia/commit/a5511e7c865f0c89728ff032ad84b871d3f7554e), [`a5511e7`](https://github.com/softistx/graxia/commit/a5511e7c865f0c89728ff032ad84b871d3f7554e), [`a5511e7`](https://github.com/softistx/graxia/commit/a5511e7c865f0c89728ff032ad84b871d3f7554e)]:
  - @graxia/core@0.2.0
