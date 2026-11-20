---
'@graxia/core': patch
---

A subscription source that throws after it has yielded now reaches `onResultChunk`: the last payload is `{ errors: [error] }` with no `data` key (before masking), over SSE and WebSocket, so a plugin no longer sees the operation end "ok". `onUnexpected` still receives the original of a plain `Error` (a thrown non-`Error` arrives as an `Error` of its string form); when a hook throws on that chunk it receives the source's error first, then the hook's.
