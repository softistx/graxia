---
"@graxia/core": patch
---

Harden 0.1.0: onValidate after-hooks run when validation throws; validation errors carry `GRAPHQL_VALIDATION_FAILED`; a parser stack overflow is a `GRAPHQL_PARSE_FAILED` error, not masked; `graxia.ready` rejects on a failing plugin `setup`, which is reported once through `onUnexpected` (phase `setup`), and `onDispose` runs only for plugins whose setup succeeded; the request id is read-only (`getRequestId`) and `fetch` never rejects; `serverContext` is required in `fetch`, `execute`, `serve` and `createTestClient` when the host context has required keys; internals (`createPluginEngine`, `orderPlugins`, `createDocumentPipeline`, `createLruCache`, `RequestState` class, `requestIdKey`, ...) are no longer exported; `graphql` peer is `^17.1.0`; docs describe only what 0.1.0 ships and its security limits.
