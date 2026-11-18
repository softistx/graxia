---
'@graxia/core': minor
---

`@defer` and `@stream` over `multipart/mixed` and server-sent events: an `incremental` option (`format: 'graphql17' | 'legacy'`, or `false`), `createSchema` adds the two directives, every initial and subsequent payload goes through `onResultChunk` and masking, and `ExecutionOutput` covers incremental results.
