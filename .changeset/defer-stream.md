---
'@graxia/core': minor
---

`@defer` and `@stream` over `multipart/mixed` and server-sent events: an `incremental` option (`IncrementalOptions`: `format: 'graphql17' | 'legacy'`, or `false`), `createSchema` adds the two directives (opt out with `incremental: false`), every initial and subsequent payload goes through `onResultChunk` and masking, and `ExecutionOutput` covers incremental results.

Breaking: a plugin's `setExecuteFn(execute)` that passes graphql's plain `execute` now throws on a schema built by `createSchema`, which declares `@defer` and `@stream`. Pass `experimentalExecuteIncrementally` (or `legacyExecuteIncrementally`) instead, or build the schema with `createSchema({ incremental: false })`. The same goes for any code that runs a `createSchema` schema through graphql's `execute` directly.

Breaking: `ExecutionOutput` also covers incremental results (`{ initialResult, subsequentResults }`); an `onExecute` after-hook must narrow `result` before reading `data` or `errors`.
