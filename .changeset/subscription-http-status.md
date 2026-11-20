---
'@graxia/core': minor
---

A subscription that fails before its source stream opens (its `subscribe` throws, or a plugin sets a result) and whose errors carry `extensions.http` now keeps its event stream but answers with that status and those headers, as in GraphQL Yoga: `http` is stripped from the `next` event, `spec: true` does not drop the status over SSE, and the status is read after the `onResultChunk` hooks and masking. This keeps a 400 or 403 promised before the stream. Without `extensions.http`, and for a failure after the first event, the answer stays a 200 stream; `errorHttp: false` keeps it too. WebSocket is unchanged.
