---
'@graxia/core': patch
---

A subscription source that throws after it has yielded now reaches `onResultChunk`: the last payload carries the thrown error in `errors` (before masking), over SSE and WebSocket, so a plugin no longer sees the operation end "ok".
