---
'@graxia/redis': minor
---

BREAKING (pre-1.0): `@graxia/redis` runs on `@softistx/redis` instead of Bun's `RedisClient` alone. `@softistx/redis` (`>=0.22.0 <1`) becomes a peer dependency, and it needs `zod` (its type declarations import it): `bun add @softistx/redis zod`. PubSub uses one shared, reconnecting subscriber connection (reopened with a backoff when Bun gives up, no double delivery), the cache is a raw cache, and a `url` is connected through `connectRedis`, so adapters of one URI share one client (the same URI must be connected with the same options everywhere; another module's options give a `GraxiaConfigError` telling you to pass `{ client }`). A use after `dispose()` rejects. The topic signature change is in its own changeset (`yoga-pubsub-redis`); channel names and cache and payload formats on Redis are unchanged, and `redisPubSub` and `redisCache` keep their other options.

Cache prefix: it is used with exactly one trailing `:`. A prefix that does not end in `:` writes new keys (`app:<key>` instead of `app<key>`); entries written by 0.1 are no longer read and expire or can be deleted. A prefix that already ends in `:` (the default) keeps its keys. A prefix with no character before its `:` (`''` or `':'`) throws a `GraxiaConfigError`.

New `redisFieldLimit({ limit, windowMs, burst?, prefix?, timeoutMs?, onError?, url? | client? })`: a core `FieldLimit` for `fieldRateLimit` shared by every process (server-timed GCRA bucket). On a Redis error it calls `onError` and lets the call through (fail open). See the guide's migration notes.
