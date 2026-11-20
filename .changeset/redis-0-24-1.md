---
'@graxia/redis': patch
---

Requires `@softistx/redis` 0.24.1 or later: queue workers re-open their blocking connection after a Redis restart.
