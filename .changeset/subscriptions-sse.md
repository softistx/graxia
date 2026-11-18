---
'@graxia/core': minor
---

Subscriptions and streamed results over server-sent events: `graphql-sse` distinct connections mode on GET and POST for any request that prefers `text/event-stream`, a `subscriptions.sse` option (`boolean | { keepAliveMs }`, 12 000 ms by default, `0` turns the comments off), `onSubscribe` and `onResultChunk` now run, and `ExecutionOutput` covers `subscribe` results.

Breaking: `ExecutionOutput` is wider (it covers `subscribe` results). An `onExecute` after-hook that read `result.data` or `result.errors` must narrow `result` first (for example `if (result && 'data' in result)`).

Breaking: server-sent events are on by default. A request that prefers `text/event-stream` was answered as plain JSON, or 406 when it allowed no JSON type, before; to keep that, pass `subscriptions: { sse: false }`.
