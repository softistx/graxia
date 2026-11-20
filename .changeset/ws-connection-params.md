---
'@graxia/core': minor
---

`ContextInit` and the `onParams` payload carry `connectionParams`, the client's `connection_init` payload, for an operation over a WebSocket only (undefined over HTTP and SSE, whatever the request's headers say). A `context` factory reads it without a cast, and an `onParams` check skips socket operations with it instead of a forgeable `Upgrade` header. It stays in `serverContext` and the resolver context too.
