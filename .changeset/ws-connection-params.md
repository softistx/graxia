---
'@graxia/core': minor
---

`ContextInit` carries `connectionParams`, the client's `connection_init` payload, for an operation over a WebSocket (undefined over HTTP and SSE), so a `context` factory reads it without a cast. It stays in `serverContext` and the resolver context too.
