# @graxia/core

## 0.8.0

### Minor Changes

- [#140](https://github.com/softistx/graxia/pull/140) [`b2b814f`](https://github.com/softistx/graxia/commit/b2b814f62d03c658b3948c45ba9dca1b71a6bc40) Thanks [@SteveGT96](https://github.com/SteveGT96)! - Add `telemetry.operationSpans: false`: when a host span is active, it drops graxia's `graphql.request` and operation spans and keeps the parse, validate and resolver spans (and the causes of masked errors) under it, a socket's operations included. With no host span graxia makes its spans as before. `telemetry: false` still turns every span off.

- [#138](https://github.com/softistx/graxia/pull/138) [`c7c407e`](https://github.com/softistx/graxia/commit/c7c407e43784e509b49066b2faeeae9494d9cc52) Thanks [@SteveGT96](https://github.com/SteveGT96)! - The payloads of `onRequest`, `onParse` and `onValidate` carry a read-only `serverContext`, over HTTP and over WebSocket (the context the upgrade was given). A host plugin can now tie a document that fails validation to its socket without a `WeakMap` keyed by the upgrade request.

### Patch Changes

- [#139](https://github.com/softistx/graxia/pull/139) [`54aaf11`](https://github.com/softistx/graxia/commit/54aaf115cf1ec6d566e37806fb18877263d7d462) Thanks [@SteveGT96](https://github.com/SteveGT96)! - A subscription source that throws after it has yielded now reaches `onResultChunk`: the last payload is `{ errors: [error] }` with no `data` key (before masking), over SSE and WebSocket, so a plugin no longer sees the operation end "ok". `onUnexpected` still receives the original of a plain `Error` (a thrown non-`Error` arrives as an `Error` of its string form); when a hook throws on that chunk it receives the source's error first, then the hook's, but only when the source's error is not a `GraphQLError` (otherwise only the hook's error).

## 0.7.0

### Minor Changes

- [#133](https://github.com/softistx/graxia/pull/133) [`b0cd3ec`](https://github.com/softistx/graxia/commit/b0cd3ec4999a20ac5bb3c435483a08424a4bb7e4) Thanks [@SteveGT96](https://github.com/SteveGT96)! - Every HTTP-level refusal now carries a stable `extensions.code`: `BODY_TOO_LARGE` (413), `UNSUPPORTED_MEDIA_TYPE` (415), `BODY_UNREADABLE`, `BODY_NOT_JSON`, `QUERY_REQUIRED`, `PARAMS_INVALID`, `BATCHING_DISABLED`, `BATCH_TOO_LARGE`, `BATCH_INVALID`, `BATCH_NOT_STREAMABLE`, `SUBPROTOCOL_REQUIRED` and `UPGRADE_FAILED` (400), `PATH_NOT_FOUND` (404), `METHOD_NOT_ALLOWED` (405, a mutation over GET included) and `NOT_ACCEPTABLE` (406). They are keys of `GraxiaErrorCodes`; the messages are unchanged.

## 0.6.3

### Patch Changes

- [#126](https://github.com/softistx/graxia/pull/126) [`5ddb586`](https://github.com/softistx/graxia/commit/5ddb5869b08d50f408ac6864a53a0c4652097c0d) Thanks [@SteveGT96](https://github.com/SteveGT96)! - `batching: true` is accepted and means `{ limit: 10 }`, Yoga's default, as the migration guide already said. A bad `batching` value now throws a `GraxiaConfigError` naming the accepted forms (`true`, `false` or `{ limit: <positive integer> }`).

- [#127](https://github.com/softistx/graxia/pull/127) [`8397f98`](https://github.com/softistx/graxia/commit/8397f98a041b82e231ef33a667876df61082dcf0) Thanks [@SteveGT96](https://github.com/SteveGT96)! - Document what an aborted `graxia.execute` returns: a result with an `OPERATION_ABORTED` error, never a rejection.

- [#130](https://github.com/softistx/graxia/pull/130) [`83904e4`](https://github.com/softistx/graxia/commit/83904e4657269574b55f6b0a61c36d44d380975e) Thanks [@SteveGT96](https://github.com/SteveGT96)! - Docs: a host that counts the request body itself (a stream that errors past its limit) gets 400 "The request body could not be read."; the migration guide, the HTTP guide and troubleshooting now say to drop the host limiter and set `limits.bodyBytes`, which answers 413 for an oversized `Content-Length` and for a chunked body, both covered by specs.

- [#129](https://github.com/softistx/graxia/pull/129) [`178a736`](https://github.com/softistx/graxia/commit/178a736f2d0ac489ce054184150aecab9a78149e) Thanks [@SteveGT96](https://github.com/SteveGT96)! - Document how a host observes each WebSocket operation (start, end, outcome, duration) with a plugin that reads the `serverContext` given to `graxia.upgrade`, in the WebSocket and plugins guides and the migration guide.

## 0.6.2

### Patch Changes

- [#114](https://github.com/softistx/graxia/pull/114) [`57441c2`](https://github.com/softistx/graxia/commit/57441c28e5256423a8d8c2f343b42564d01128d4) Thanks [@SteveGT96](https://github.com/SteveGT96)! - Internal: the `Graxia` instance type moves to its own module. No behaviour or public export changes.

- [#109](https://github.com/softistx/graxia/pull/109) [`566a13c`](https://github.com/softistx/graxia/commit/566a13c3ef9d8d018bab10a3868401b9d7512ca1) Thanks [@SteveGT96](https://github.com/SteveGT96)! - Docs: the troubleshooting page is split by topic (schema, plugins, limits, subscriptions, HTTP, security, rate limits, uploads), each entry still headed by its exact message.

- [#115](https://github.com/softistx/graxia/pull/115) [`7503614`](https://github.com/softistx/graxia/commit/750361498e9c78ebf67b33c718e1754b47326d67) Thanks [@SteveGT96](https://github.com/SteveGT96)! - A `GraphQLError` thrown by a subscription's source iterator while it iterates (SSE and WebSocket) is now exposed as is, with its message and extensions (and path, when it sets one), instead of `Unexpected error.`. A plain `Error` stays masked and reported through `onUnexpected`.

## 0.6.1

### Patch Changes

- [#107](https://github.com/softistx/graxia/pull/107) [`e9b0f4a`](https://github.com/softistx/graxia/commit/e9b0f4acfc411bf1d347d49c894ae7206bdf75c8) Thanks [@SteveGT96](https://github.com/SteveGT96)! - Fewer allocations per request on the hot path: the `Accept` header is read once, responses graxia builds are sealed in place, a passing cost check is remembered per document and stages without hooks run without promises (in the repository benchmark, a cached document goes from 23.2 KB to 16.1 KB of heap per request and serves about 12 to 26 % more requests per second).

## 0.6.0

### Minor Changes

- [#103](https://github.com/softistx/graxia/pull/103) [`33ef321`](https://github.com/softistx/graxia/commit/33ef3215c1efaabcb615c1484134d720a0310a11) Thanks [@SteveGT96](https://github.com/SteveGT96)! - Plugin support for the Envelop adapter: `setup` receives the instance's `schema`, `onExecute` and `onSubscribe` payloads expose `executeFn` (the last one set, else the engine's), and a `GraphQLError` with its own `extensions.code` thrown by a parse function keeps it instead of becoming `GRAPHQL_PARSE_FAILED`.

- [#103](https://github.com/softistx/graxia/pull/103) [`33ef321`](https://github.com/softistx/graxia/commit/33ef3215c1efaabcb615c1484134d720a0310a11) Thanks [@SteveGT96](https://github.com/SteveGT96)! - Multipart file uploads (the GraphQL multipart request spec), behind a new `uploads` option that is off by default: `createGraxia({ schema, uploads: true })` reads `operations`, `map` and one part per file, under `uploads.bodyBytes` (16 MiB), `uploads.fileBytes` (8 MiB) and `uploads.files` (10), and hands resolvers Bun's Web `File` through the new `GraphQLFile` scalar. A multipart request always needs the CSRF header, and `createGraxia` refuses `uploads` with that check off. New error codes `UPLOADS_NOT_ENABLED`, `UPLOAD_TOO_LARGE`, `UPLOAD_TOO_MANY_FILES` and `UPLOAD_INVALID`. A server without `uploads` is unchanged, except that a multipart POST now answers 415 `UPLOADS_NOT_ENABLED` instead of an untyped 415 (it was a 403 without the CSRF header, as before).

  A resolver can annotate concrete argument types, such as `({ file }: { file: File })`: unannotated resolver `args` are now `any` (was `Record<string, unknown>`), and `ctx` stays checked.

### Patch Changes

- [#103](https://github.com/softistx/graxia/pull/103) [`33ef321`](https://github.com/softistx/graxia/commit/33ef3215c1efaabcb615c1484134d720a0310a11) Thanks [@SteveGT96](https://github.com/SteveGT96)! - Docs: a migration guide from `@alxia/graphql` and a host-embedding example, linked from the HTTP, WebSocket and context guides.

## 0.5.0

### Minor Changes

- [#95](https://github.com/softistx/graxia/pull/95) [`6ec2589`](https://github.com/softistx/graxia/commit/6ec2589e1de9241b8d6fc52de73a66ef629bd0e1) Thanks [@SteveGT96](https://github.com/SteveGT96)! - Add `@graxia/core/agent`: the descriptive directives `@needs`, `@constraint` and `@errors`, `@needs(anyOf:)`, `printSchemaFor(schema, { can })` and `visibleSchema` for the schema one caller may see (always with a valid `Query`), `lintDescriptions`, and readers (`needsOf`, `constraintOf`, `errorsOf`). Every error graxia emits now carries `extensions.fix`, including parse and validation failures, variable errors and HTTP refusals; messages and codes are unchanged. The permission predicate type `Can` (`(permission: string) => boolean`) is exported from `@graxia/core/agent`.

- [#95](https://github.com/softistx/graxia/pull/95) [`6ec2589`](https://github.com/softistx/graxia/commit/6ec2589e1de9241b8d6fc52de73a66ef629bd0e1) Thanks [@SteveGT96](https://github.com/SteveGT96)! - `Graxia` exposes `schema` (the schema it serves) and `limits` (`{ bodyBytes, tokens }`, defaults applied), so a layer in front of it, such as `@graxia/mcp`, reads them instead of taking them twice.

  `Graxia` also exposes `trustedDocuments` (`{ mode: 'strict' | 'mixed' }` in force, the `NODE_ENV` default applied; `undefined` without the option), so a layer that forwards client documents to `graxia.execute` can refuse them in `strict`. A missing or invalid variable (refused by graphql before any field runs) and an unknown or missing operation name now carry `extensions.code: "BAD_USER_INPUT"` beside their `fix` (they had no code). `ApolloPersistedQueryManifest` types `format` as `string` and `version` as `number`, so a manifest imported from JSON type-checks; the values are still checked at boot.

## 0.4.0

### Minor Changes

- [#84](https://github.com/softistx/graxia/pull/84) [`ce91d85`](https://github.com/softistx/graxia/commit/ce91d850a918083960a2e40d0297652003312fa9) Thanks [@SteveGT96](https://github.com/SteveGT96)! - BREAKING (pre-1.0): `createSchema<Ctx, Resolvers>()` now refuses a resolver map whose context does not match `Ctx`: a `Resolvers<Other>` generated by graphql-codegen (or any map whose field resolvers expect another context) is a type error on `resolvers`, where it used to compile. Graphql-codegen's `typescript` and `typescript-resolvers` output is compiled against graxia in its tests, and a new Codegen guide covers `contextType` with `InferContext`, mappers and `enumValues`. Migration: a `Resolvers` generated for another context: point codegen's `contextType` at your `InferContext` type and regenerate; see the Codegen guide.

- [#84](https://github.com/softistx/graxia/pull/84) [`ce91d85`](https://github.com/softistx/graxia/commit/ce91d850a918083960a2e40d0297652003312fa9) Thanks [@SteveGT96](https://github.com/SteveGT96)! - A plugin may declare `csrfExempt(request)` to serve its own `GET` pages (a browser navigation cannot send the CSRF header). Core consults it for `GET` only and only for the CSRF header check; the request must be answered by a plugin's `onRequest`, or it is refused with the 403 `CSRF_HEADER_REQUIRED` as before, so an exempt request never executes an operation. `setup(api)` also receives `api.transports` (`{ sse, ws }`, read-only), the subscription transports the instance has on, so a plugin can pick one without a setting.

- [#84](https://github.com/softistx/graxia/pull/84) [`ce91d85`](https://github.com/softistx/graxia/commit/ce91d850a918083960a2e40d0297652003312fa9) Thanks [@SteveGT96](https://github.com/SteveGT96)! - BREAKING (pre-1.0): Write the resolver context once: `InferContext<typeof context, typeof plugins>` derives its type from the `context` factory, the plugins and `signal`, and `createGraxia` checks at compile time that it satisfies the schema's `createSchema<Ctx>()` context (a missing or wrong key is a type error on `context`). A plain `GraphQLSchema` is not checked. `createGraxia` gains inferred type parameters (`Schema`, `Plugins`, `Made`) after `HostCtx`; new types `InferContext`, `CoreContext` and `ContextFactory`; `ContextInit` now defaults its parameter. Code whose context did not satisfy `createSchema<Ctx>` now fails to compile: return the missing keys from the `context` factory, or add the plugin that provides them. Type the host on the factory (`ContextInit<{ … }>`), never with `createGraxia<…>`, which turns the check off.

- [#84](https://github.com/softistx/graxia/pull/84) [`ce91d85`](https://github.com/softistx/graxia/commit/ce91d850a918083960a2e40d0297652003312fa9) Thanks [@SteveGT96](https://github.com/SteveGT96)! - BREAKING (pre-1.0): Telemetry runs on the in-house `@softistx/telemetry` instead of `@opentelemetry/api`. The optional peer `@opentelemetry/api` `^1` is replaced by the optional peer `@softistx/telemetry` `^0.4.1`; without it graxia still traces nothing and wraps nothing. Migration: `bun add @softistx/telemetry` (and an exporter such as `@softistx/telemetry-otlp`) instead of the OpenTelemetry API and SDK packages, `createTelemetry('my-api', { exporters }).install()` instead of registering a tracer provider and a context manager, and `telemetry: { instance }` (a `Telemetry` from `createTelemetry`) instead of `telemetry: { tracer }`; a `tracer` option now throws `telemetry.tracer was replaced by telemetry.instance (…)`, and an invalid `instance` throws `telemetry.instance must be a @softistx/telemetry Telemetry`. Span names and attributes are unchanged. Differences: a failure that is an `AbortError` or a `TimeoutError` ends the span `cancelled` rather than `error`, and a WebSocket operation span is now a child of the upgrade's `graphql.request` span (same trace as the upgrade request's `traceparent`). The operation span records the first unexpected error only; `graphql.error.count` still counts all. The new type `TelemetryInstance` describes `instance` structurally.

- [#84](https://github.com/softistx/graxia/pull/84) [`ce91d85`](https://github.com/softistx/graxia/commit/ce91d850a918083960a2e40d0297652003312fa9) Thanks [@SteveGT96](https://github.com/SteveGT96)! - BREAKING (pre-1.0): the PubSub has the shape of GraphQL Yoga's `createPubSub`. `createMemoryPubSub` becomes `createPubSub`; topics are tuples (`{ post: [id: string, payload: Post]; tick: [payload: number] }`); `subscribe(topic, id?)` and `publish(topic, id?, payload)` replace `post:${id}` template keys, and the `SubscribeOptions` argument is gone: the engine returns the subscription's iterator when the operation's signal aborts, so no `{ signal }` is passed (`bufferSize` is set on `createPubSub` only). `filterIterable` and `mapIterable` are removed for Yoga's `pipe`, `filter` and `map`. `subscriberCount(topic, id?)` takes the id. `subscribe()` reads the operation's `signal` from the operation context and ends the subscriber at once (an `async function*` relay included). A topic without payload (`[]`) delivers `null`. New types `PubSubIterator`, `PubSubPayload`, `PubSubSubscribeArgs`, `Operator`. Migration: `createMemoryPubSub<{ tick: number }>()` → `createPubSub<{ tick: [payload: number] }>()`; ``subscribe(`post:${id}`, { signal })`` → `subscribe('post', id)`; `filterIterable(src, fn)` → `pipe(src, filter(fn))`. See the PubSub guide.

### Patch Changes

- [#84](https://github.com/softistx/graxia/pull/84) [`ce91d85`](https://github.com/softistx/graxia/commit/ce91d850a918083960a2e40d0297652003312fa9) Thanks [@SteveGT96](https://github.com/SteveGT96)! - `@defer` and `@stream` now stream over `multipart/mixed` when a client names it after JSON, as GraphiQL does (`Accept: application/json, multipart/mixed`); it used to answer `INCREMENTAL_NOT_SUPPORTED`. Only an incremental operation is affected: `Accept: application/json` alone is still refused, and any other operation keeps JSON.

- [#66](https://github.com/softistx/graxia/pull/66) [`7731216`](https://github.com/softistx/graxia/commit/7731216aa371de460c0360a461902363d1586681) Thanks [@SteveGT96](https://github.com/SteveGT96)! - Update the roadmap: secure by default shipped, the built-in explorer is next.

## 0.3.0

### Minor Changes

- [#63](https://github.com/softistx/graxia/pull/63) [`bf5497c`](https://github.com/softistx/graxia/commit/bf5497c71e62bc37a48cb3ae48f37bd973e2e499) Thanks [@SteveGT96](https://github.com/SteveGT96)! - CSRF prevention, same-origin checks, a WebSocket Origin check, and introspection and suggestions off in production: new `csrf` (`requireHeader`, `sameOrigin`), `introspection` and `suggestions` options and `DEFAULT_CSRF_HEADERS`. **Breaking**: a `GET` or a non-JSON `POST` without one of the CSRF headers is refused with 403 `CSRF_HEADER_REQUIRED` (`csrf: { requireHeader: false }` turns it off), which includes a browser `EventSource` (it cannot set headers): use `graphql-sse`, or `requireHeader: false` with `sameOrigin` on; a WebSocket upgrade from another origin is refused with 403 `FORBIDDEN_ORIGIN` unless listed in `csrf.sameOrigin.allowedOrigins`; under `NODE_ENV=production` introspection and "Did you mean" suggestions are off unless set to `true`.

- [#55](https://github.com/softistx/graxia/pull/55) [`5c22fdd`](https://github.com/softistx/graxia/commit/5c22fdde87b81a6fff3074b61020b08df3b01c5c) Thanks [@SteveGT96](https://github.com/SteveGT96)! - `definePlugin({ ... })` now takes a plugin that requires no context directly, inferring what its `onContext` adds; `definePlugin<In>()({ ... })` stays for plugins that require a context. `definePlugin()({ ... })` keeps working.

- [#63](https://github.com/softistx/graxia/pull/63) [`bf5497c`](https://github.com/softistx/graxia/commit/bf5497c71e62bc37a48cb3ae48f37bd973e2e499) Thanks [@SteveGT96](https://github.com/SteveGT96)! - fieldRateLimit: per-field rate limits counted across aliases and fragments, single-selection fields, 429 with Retry-After. Adds `memoryFieldLimit`, `limitFromStore`, `DEFAULT_LIMIT_CODE` and the `RATE_LIMITED` and `FIELD_SELECTED_ONCE` error codes. Opt-in: nothing changes without the plugin.

- [#63](https://github.com/softistx/graxia/pull/63) [`bf5497c`](https://github.com/softistx/graxia/commit/bf5497c71e62bc37a48cb3ae48f37bd973e2e499) Thanks [@SteveGT96](https://github.com/SteveGT96)! - OpenTelemetry spans for requests, parse, validate and operations, optional resolver spans; `@opentelemetry/api` is an optional peer. New `telemetry` option (`false`, or `{ tracer, resolverSpans, document, propagate }`) and the `TelemetryOptions` type. On by default when `@opentelemetry/api` is installed, a no-op otherwise; nothing changes for an application without the peer.

- [#63](https://github.com/softistx/graxia/pull/63) [`bf5497c`](https://github.com/softistx/graxia/commit/bf5497c71e62bc37a48cb3ae48f37bd973e2e499) Thanks [@SteveGT96](https://github.com/SteveGT96)! - operation limits: depth, aliases, directives, root fields and cost (`@cost` / `@listSize`), on by default. **Breaking**: operations over the new defaults (depth 12, 30 aliases, 50 directives, 20 root fields, cost 5 000) are now refused with `GRAPHQL_VALIDATION_FAILED`; raise a limit or set it to `false`. A schema that declares `@cost` or `@listSize` with another shape than graxia's (for example `@cost(weight: String!)`) now fails `createGraxia` with a `GraxiaConfigError` instead of failing each operation; rename or drop it, or set `limits: { cost: false }`. Adds `computeOperationCost`, `costDirectives` and the `DEFAULT_MAX_*` constants.

- [#63](https://github.com/softistx/graxia/pull/63) [`bf5497c`](https://github.com/softistx/graxia/commit/bf5497c71e62bc37a48cb3ae48f37bd973e2e499) Thanks [@SteveGT96](https://github.com/SteveGT96)! - trusted documents: manifests (Relay, graphql-codegen, Apollo), `documentId` (HTTP, SSE, WebSocket, `execute`), automatic persisted queries and a strict mode, on in production when `trustedDocuments` is configured. Valid requests are unaffected when the option is absent. Adds `PERSISTED_QUERY_*` and `PROVIDED_SHA_DOESNT_MATCH` error codes, `GraphQLParams.documentId`, and `documentId` on `graxia.execute` and the test client. A `documentId` that is not a string is now a 400 (it was ignored). **Breaking (types)**: `ExecuteBase` became a union alias (`document` or `documentId`, exclusive), so `interface X extends ExecuteBase` no longer compiles; write `type X = ExecuteBase<R, V> & { … }`. In `strict` mode, `graxia.execute` still runs a document you give it (it is in-process), and such a document is never stored as an APQ.

### Patch Changes

- [#63](https://github.com/softistx/graxia/pull/63) [`bf5497c`](https://github.com/softistx/graxia/commit/bf5497c71e62bc37a48cb3ae48f37bd973e2e499) Thanks [@SteveGT96](https://github.com/SteveGT96)! - Production guide and profile spec: a checklist page (what `NODE_ENV=production` changes, a recommended configuration, proxies, shutdown, health checks) and a spec running the secure-by-default profile end to end. Corrects the trusted documents guide: `redisCache` sets no expiry on registered queries.

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
