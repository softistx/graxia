---
'@graxia/redis': minor
---

BREAKING (pre-1.0): `@graxia/redis` runs on `@softistx/redis` 0.22 instead of Bun's `RedisClient` alone. `@softistx/redis` (`^0.22.0`) becomes a peer dependency: `bun add @softistx/redis`. PubSub uses one shared, reconnecting subscriber connection (reopened with a backoff when Bun gives up, no double delivery), the cache is a raw cache, and a `url` is connected through `connectRedis`, so adapters of one URI share one client. `redisPubSub`, `redisCache`, their options and the Redis wire formats are unchanged, except that a `redisCache` `prefix` without a trailing `:` now gets one (`'app'` stored `app<key>`, now `app:<key>`; add the `:` to keep existing keys). New `redisFieldLimit({ limit, windowMs, burst?, prefix?, url? | client? })`: a core `FieldLimit` for `fieldRateLimit` shared by every process (server-timed GCRA bucket). See the guide's migration notes.
