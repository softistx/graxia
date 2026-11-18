---
'@graxia/core': minor
---

Add `graxia.execute({ document, variables, operationName, headers, serverContext, signal })`, the in-process execution through the same pipeline as HTTP (it rejects with `GraxiaExecuteError` when a plugin short-circuits or the instance is disposed), the `TypedDocument` / `TypedString` types, and the `@graxia/core/testing` subpath with `createTestClient` (GET, POST, headers, persisted-query hash, batch) and `expectNoErrors`.
