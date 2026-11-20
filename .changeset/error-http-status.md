---
'@graxia/core': minor
---

A GraphQL error's `extensions.http` now sets the status and headers of a plain JSON response, as in GraphQL Yoga: the highest `http.status` wins, `http.headers` are merged, and `http` is removed from the serialized extensions. A plugin refusal still wins, a masked error carries nothing, and a batch, SSE and WebSocket ignore it. Turn it off with `http: { errorStatus: false }`.
