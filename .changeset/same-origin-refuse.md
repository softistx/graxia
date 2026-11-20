---
'@graxia/core': minor
---

`csrf.sameOrigin.onRefused(request, { reason, websocket })` answers a refused origin with your own `Response` (it may be async) in place of the 403 `FORBIDDEN_ORIGIN`, a refused WebSocket upgrade's included. `reason` is `'cross-origin'`, `'null-origin'` or `'no-origin'` (no `Origin` header, `Sec-Fetch-Site` cross-site or same-site); the new types are `OriginRefusal` and `OriginRefusalReason`. Returning `undefined` keeps the default 403, the answer gets `cache-control: no-store` unless it sets one, and a throw is a 500 reported to `onUnexpected`. Without it nothing changes.
