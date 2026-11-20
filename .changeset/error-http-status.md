---
'@graxia/core': minor
---

A GraphQL error's `extensions.http` now sets the status and headers of a plain JSON response, as in GraphQL Yoga: the highest `http.status` wins and `http.headers` are added when the plugins and the response do not set them (framing headers are dropped). `http` is removed from the serialized extensions of every transport (batch, SSE, multipart, WebSocket). A plugin refusal still wins, a masked error carries nothing, and a batch, SSE and WebSocket keep their own status. Turn it off with `errorHttp: false`; the `ErrorHttp` type is exported.
