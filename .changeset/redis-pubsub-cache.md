---
'@graxia/redis': minor
---

Redis PubSub and cache on Bun's Redis client: `redisPubSub` (the `PubSub` contract across processes, one shared SUBSCRIBE per topic, resubscribe on reconnect, `ready()`) and `redisCache` (the `KeyValueCache` contract with `PX` expiry).
