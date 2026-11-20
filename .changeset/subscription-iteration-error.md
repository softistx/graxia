---
'@graxia/core': patch
---

A `GraphQLError` thrown by a subscription's source iterator while it iterates (SSE and WebSocket) is now exposed as is, with its message and extensions (and path, when it sets one), instead of `Unexpected error.`. A plain `Error` stays masked and reported through `onUnexpected`.
