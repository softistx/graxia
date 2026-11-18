# @graxia/core

## 0.1.0

### Minor Changes

- [#41](https://github.com/softistx/graxia/pull/41) [`f3e7362`](https://github.com/softistx/graxia/commit/f3e73624d076054045fd1102527692e174c40a0e) Thanks [@SteveGT96](https://github.com/SteveGT96)! - Add one context per operation (batch entries included), a cancellation `signal` (client disconnect or shutdown) in `ContextInit`, the context and graphql's `abortSignal`, `getContext()` / `tryGetContext()` with the `asyncContext` option, `graxia.dispose()` / `Symbol.asyncDispose` that drains in-flight operations (503 `SHUTTING_DOWN` for new ones, `shutdownTimeout`) and the plugin hook `onDispose`.

- [#41](https://github.com/softistx/graxia/pull/41) [`f3e7362`](https://github.com/softistx/graxia/commit/f3e73624d076054045fd1102527692e174c40a0e) Thanks [@SteveGT96](https://github.com/SteveGT96)! - Add `createSchema`: build a graphql schema from SDL (string, document or array, `extend type` included) and typed resolvers (merged from arrays, custom scalars, enum values, `__resolveType`, `__isTypeOf`, subscriptions), with an optional codegen resolvers generic.

- [#41](https://github.com/softistx/graxia/pull/41) [`f3e7362`](https://github.com/softistx/graxia/commit/f3e73624d076054045fd1102527692e174c40a0e) Thanks [@SteveGT96](https://github.com/SteveGT96)! - Add error handling: `exposedError(code, message, { extensions?, fix? })` with typed, augmentable `GraxiaErrorCodes`; unexpected resolver errors are masked as `Unexpected error.` with `INTERNAL_SERVER_ERROR` and a correlation id (the request id) in every environment, with `maskError` and `maskErrors` options; `onUnexpected` now receives `{ requestId, correlationId, phase }`; the generic 500 carries the correlation id.

- [#41](https://github.com/softistx/graxia/pull/41) [`f3e7362`](https://github.com/softistx/graxia/commit/f3e73624d076054045fd1102527692e174c40a0e) Thanks [@SteveGT96](https://github.com/SteveGT96)! - Add `graxia.execute({ document, variables, operationName, headers, serverContext, signal })`, the in-process execution through the same pipeline as HTTP (it rejects with `GraxiaExecuteError` when a plugin short-circuits or the instance is disposed), the `TypedDocument` / `TypedString` types, and the `@graxia/core/testing` subpath with `createTestClient` (GET, POST, headers, persisted-query hash, batch) and `expectNoErrors`.

- [#41](https://github.com/softistx/graxia/pull/41) [`f3e7362`](https://github.com/softistx/graxia/commit/f3e73624d076054045fd1102527692e174c40a0e) Thanks [@SteveGT96](https://github.com/SteveGT96)! - Add `createGraxia` with the GraphQL over HTTP transport: `fetch(request, serverContext)` and `serve()`, GET and POST, content negotiation, status codes, streamed body limit (413), 415, opt-in batching, request id, plugin `responseHeaders`. Passes the `graphql-http` server audits.

- [#41](https://github.com/softistx/graxia/pull/41) [`f3e7362`](https://github.com/softistx/graxia/commit/f3e73624d076054045fd1102527692e174c40a0e) Thanks [@SteveGT96](https://github.com/SteveGT96)! - Add the parse and validation pipeline: `createDocumentPipeline` with token and nesting limits (stack overflow reported as `GRAPHQL_PARSE_FAILED`), a weighted LRU parse cache (failures cached), a per-schema validation cache, and `onParse` / `onValidate` driven through the plugin engine.

- [#41](https://github.com/softistx/graxia/pull/41) [`f3e7362`](https://github.com/softistx/graxia/commit/f3e73624d076054045fd1102527692e174c40a0e) Thanks [@SteveGT96](https://github.com/SteveGT96)! - Add the plugin engine and its types: `definePlugin`, ordered hooks with after-hooks, short-circuit helpers, typed per-request state keys and typed context extension.

### Patch Changes

- [#41](https://github.com/softistx/graxia/pull/41) [`f3e7362`](https://github.com/softistx/graxia/commit/f3e73624d076054045fd1102527692e174c40a0e) Thanks [@SteveGT96](https://github.com/SteveGT96)! - Docs: npm page, roadmap, troubleshooting.

- [#41](https://github.com/softistx/graxia/pull/41) [`f3e7362`](https://github.com/softistx/graxia/commit/f3e73624d076054045fd1102527692e174c40a0e) Thanks [@SteveGT96](https://github.com/SteveGT96)! - Harden 0.1.0: onValidate after-hooks run when validation throws; validation errors carry `GRAPHQL_VALIDATION_FAILED`; a parser stack overflow is a `GRAPHQL_PARSE_FAILED` error, not masked; `graxia.ready` rejects on a failing plugin `setup`, which is reported once through `onUnexpected` (phase `setup`), and `onDispose` runs only for plugins whose setup succeeded; the request id is read-only (`getRequestId`) and `fetch` never rejects; `serverContext` is required in `fetch`, `execute`, `serve` and `createTestClient` when the host context has required keys; internals (`createPluginEngine`, `orderPlugins`, `createDocumentPipeline`, `createLruCache`, `RequestState` class, `requestIdKey`, ...) are no longer exported; `graphql` peer is `^17.1.0`; docs describe only what 0.1.0 ships and its security limits.
