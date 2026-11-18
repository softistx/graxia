# @graxia/core

## 0.2.0

### Minor Changes

- [#52](https://github.com/softistx/graxia/pull/52) [`a5511e7`](https://github.com/softistx/graxia/commit/a5511e7c865f0c89728ff032ad84b871d3f7554e) Thanks [@SteveGT96](https://github.com/SteveGT96)! - A key-value cache contract with an in-memory implementation: `KeyValueCache` and `createMemoryCache` (LRU, per-entry time to live). Nothing in core consumes it yet; `@graxia/redis` implements it.

- [#52](https://github.com/softistx/graxia/pull/52) [`a5511e7`](https://github.com/softistx/graxia/commit/a5511e7c865f0c89728ff032ad84b871d3f7554e) Thanks [@SteveGT96](https://github.com/SteveGT96)! - `@defer` and `@stream` over `multipart/mixed` and server-sent events: an `incremental` option (`IncrementalOptions`: `format: 'graphql17' | 'legacy'`, or `false`), `createSchema` adds the two directives (opt out with `incremental: false`), every initial and subsequent payload goes through `onResultChunk` and masking, and `ExecutionOutput` covers incremental results.

  Breaking: a plugin's `setExecuteFn(execute)` that passes graphql's plain `execute` now throws on a schema built by `createSchema`, which declares `@defer` and `@stream`. Pass `experimentalExecuteIncrementally` (or `legacyExecuteIncrementally`) instead, or build the schema with `createSchema({ incremental: false })`. The same goes for any code that runs a `createSchema` schema through graphql's `execute` directly.

  Breaking: `ExecutionOutput` also covers incremental results (`{ initialResult, subsequentResults }`); an `onExecute` after-hook must narrow `result` before reading `data` or `errors`.

- [#52](https://github.com/softistx/graxia/pull/52) [`a5511e7`](https://github.com/softistx/graxia/commit/a5511e7c865f0c89728ff032ad84b871d3f7554e) Thanks [@SteveGT96](https://github.com/SteveGT96)! - Streaming polish: a single query or mutation result sent over SSE or WebSocket now runs `onResultChunk` and masking inside its operation's `getContext()` scope, and a WebSocket `error` result (a validation failure) goes through `onResultChunk` like an SSE `next`. Over HTTP (multipart/mixed, SSE), `dispose()` ends subscription streams at once but lets an incremental query or mutation drain, within `shutdownTimeout`, before it is cut; over WebSocket it closes the socket with 1001 and ends every operation on it. `subscriptions.sse` accepts `{ keepAliveMs }` like `subscriptions.ws` (an integer from 0 to 2147483647; `0` turns the keep-alive off). The refusal of a subscription sent as plain JSON names the transports that are on. A WebSocket close reason is cut to 123 UTF-8 bytes without splitting a character.

- [#52](https://github.com/softistx/graxia/pull/52) [`a5511e7`](https://github.com/softistx/graxia/commit/a5511e7c865f0c89728ff032ad84b871d3f7554e) Thanks [@SteveGT96](https://github.com/SteveGT96)! - Subscriptions and streamed results over server-sent events: `graphql-sse` distinct connections mode on GET and POST for any request that prefers `text/event-stream`, a `subscriptions.sse` option (`boolean | { keepAliveMs }`, 12 000 ms by default, `0` turns the comments off), `onSubscribe` and `onResultChunk` now run, and `ExecutionOutput` covers `subscribe` results.

  Breaking: `ExecutionOutput` is wider (it covers `subscribe` results). An `onExecute` after-hook that read `result.data` or `result.errors` must narrow `result` first (for example `if (result && 'data' in result)`).

  Breaking: server-sent events are on by default. A request that prefers `text/event-stream` was answered as plain JSON, or 406 when it allowed no JSON type, before; to keep that, pass `subscriptions: { sse: false }`.

- [#52](https://github.com/softistx/graxia/pull/52) [`a5511e7`](https://github.com/softistx/graxia/commit/a5511e7c865f0c89728ff032ad84b871d3f7554e) Thanks [@SteveGT96](https://github.com/SteveGT96)! - Subscriptions over WebSocket (graphql-transport-ws): `subscriptions.ws` (`connectionInitWaitTimeout`, `keepAliveMs`, `maxPayloadBytes`, `onConnect`, `onDisconnect`), wired by `serve()`, `graxia.isUpgrade(request)`, `graxia.upgrade(request, server)` (resolves `undefined` once upgraded, else the refusal `Response`) and `graxia.websocket` for your own `Bun.serve`; `serve()` now returns `Bun.Server<GraxiaSocketData>`; `dispose()` closes sockets with 1001. `createGraxia`'s serve and fetch wiring moved to its own module.

  Breaking: WebSocket is on by default, on the endpoint's path, and `serve()` returns `Bun.Server<GraxiaSocketData>`. An upgrade request was answered by the normal HTTP handling before; to keep that, pass `subscriptions: { ws: false }`. A cookie-authenticated browser app must also check `Origin` on the upgrade (see the README's "Security").

- [#52](https://github.com/softistx/graxia/pull/52) [`a5511e7`](https://github.com/softistx/graxia/commit/a5511e7c865f0c89728ff032ad84b871d3f7554e) Thanks [@SteveGT96](https://github.com/SteveGT96)! - Add a typed `PubSub` with an in-memory implementation (`createMemoryPubSub`) and the `filterIterable` / `mapIterable` helpers for subscription resolvers.

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
