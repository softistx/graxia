---
'@graxia/core': minor
---

A subscription that fails before its source stream opens (its `subscribe` throws, or a plugin sets a result) and whose errors carry `extensions.http` is now answered over SSE as a plain JSON response, like a query: the status and headers of `extensions.http`, the media type per `Accept`, and `http` stripped from the body. This keeps a 400 or 403 promised before the stream, as in GraphQL Yoga. Without `extensions.http`, and for a failure after the first event, the answer stays a 200 stream; `errorHttp: false` keeps the stream too. WebSocket is unchanged.
