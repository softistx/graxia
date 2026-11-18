---
'@graxia/core': minor
---

Streaming polish: a single query or mutation result sent over SSE or WebSocket now runs `onResultChunk` and masking inside its operation's `getContext()` scope, and a WebSocket `error` result (a validation failure) goes through `onResultChunk` like an SSE `next`. `dispose()` ends subscription streams at once but lets an incremental query or mutation drain, within `shutdownTimeout`, before it is cut. `subscriptions.sse` accepts `{ keepAliveMs }` like `subscriptions.ws` (an integer of at least 0; `0` turns the keep-alive off). The refusal of a subscription sent as plain JSON names the transports that are on. A WebSocket close reason is cut to 123 UTF-8 bytes without splitting a character.
