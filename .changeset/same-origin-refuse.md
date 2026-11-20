---
'@graxia/core': minor
---

`csrf.sameOrigin.refuse(request, reason)` answers a refused origin with your own `Response` (it may be async) in place of the 403 `FORBIDDEN_ORIGIN`. `reason` is `'cross-origin'`, `'null-origin'` or `'cross-site'` (the new `OriginRefusalReason` type). It covers a WebSocket upgrade too; without it nothing changes.
