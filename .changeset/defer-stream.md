---
'@graxia/core': minor
---

`@defer` and `@stream` over `multipart/mixed` and server-sent events: an `incremental` option (`IncrementalOptions`: `format: 'graphql17' | 'legacy'`, or `false`), `createSchema` adds the two directives (opt out with `incremental: false`), every initial and subsequent payload goes through `onResultChunk` and masking, and `ExecutionOutput` covers incremental results.

Note: graphql's plain `execute` now refuses a `createSchema` schema unless it is built with `incremental: false`.
