---
'@graxia/core': minor
---

A key-value cache contract with an in-memory implementation: `KeyValueCache` and `createMemoryCache` (LRU, per-entry time to live). Nothing in core consumes it yet; `@graxia/redis` implements it.
