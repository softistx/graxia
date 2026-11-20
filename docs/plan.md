# graxia — implementation plan

Bun-only GraphQL server engine. Repo `softistx/graxia` (public, MIT), npm scope `@graxia/*`, graphql-js 17 only (peer `^17`). 0.x until apps run it in production (after `@alxia/graphql` switches to it in a major), then 1.0.

## Decisions

- Generic engine that replaces graphql-yoga under the public `@alxia/graphql` package; `@alxia/graphql` keeps the application conventions.
- Bun only (Bun.serve, native WebSocket, Redis through `@softistx/redis`, a peer). No Node/Deno adapters.
- graphql 17 only, @defer/@stream from day one, tracked to each release.
- Schema: any `GraphQLSchema` + SDL/typed-resolvers helper. No code-first builder in v1.
- Executor: graphql 17 execute/subscribe + parse/validation caches; swappable via hook; JIT later as a plugin.
- Plugins: own typed lifecycle hooks, explicit order (pre/post), typed per-request state, context extension with inference. `@graxia/envelop` adapter for Envelop plugins.
- Transports v1: GraphQL-over-HTTP (graphql-http audit green), SSE (graphql-sse), graphql-ws on Bun WebSocket, @defer/@stream (multipart/mixed and SSE).
- Core built-ins: trusted documents (APQ + manifest, strict in prod), OpenTelemetry, typed context via AsyncLocalStorage + AbortSignal, protections on by default.
- Errors: unexpected masked in prod (generic + correlation id); exposed error with typed `extensions.code` passes through.
- Adapters: PubSub/cache interfaces + in-memory; `@graxia/redis` on `@softistx/redis` (peer).
- Explorer: `@graxia/graphiql` (GraphiQL 4 bundled, no CDN) + Apollo Sandbox option; dev on, prod off.
- AI ready: `@graxia/mcp`, agent-readable schema, Claude Code plugin + llms.txt. (LLM token streaming: not in scope.)
- Docs: README per package + docs/ (guides, troubleshooting, roadmap), no private app names.

## Assumed choices (recommended options taken, reversible)

- Q1 publishing: a "Version packages" PR made locally with `changeset version`; pushing tag `v<x.y.z>` runs publish.yml → `changeset publish` (skips published versions), org secret `NPM_TOKEN`. That token's npm user must be a member of the `graxia` npm org before S8.
- Q2 type checking: `typecheck` = `bun check`; Biome's script is named `lint`/`fix`, never `check`.
- Q3 MCP: use `@modelcontextprotocol/sdk` (web-standard transport), pinned.
- Q4 Redis specs: CI service container when the runner has Docker, otherwise skipped without `REDIS_URL` (run locally).
- Q5 cost defaults: decided in S14 (proposal `cost.max` 5 000, list size 10 without `@listSize`).
- Q6 graphql-sse single-connection mode: later, not v1 (not needed for parity).

## 1. Packages

| Package            | Responsibility                                                                                                                                                                                                                                                                                                                                                                | Deps                                                           |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `@graxia/core`     | `createGraxia`, plugin engine, GraphQL over HTTP, SSE, multipart incremental, graphql-transport-ws on Bun WebSocket, parse/validation caches, limits, CSRF/sameOrigin, introspection policy, trusted documents, fieldRateLimit, error masking, ALS context, AbortSignal, telemetry, `PubSub`/`KeyValueCache` + memory impls, `createSchema`. Subpaths `./testing`, `./agent`. | peer `graphql ^17`; optional peer `@softistx/telemetry ^0.5.0` |
| `@graxia/redis`    | `redisPubSub()`, `redisCache()` on `@softistx/redis`                                                                                                                                                                                                                                                                                                                          | peer core                                                      |
| `@graxia/graphiql` | GraphiQL 4 bundled (hashed assets, strict CSP); `apolloSandbox()` (CDN, dev-only CSP exception)                                                                                                                                                                                                                                                                               | peer core                                                      |
| `@graxia/mcp`      | MCP over Streamable HTTP; tools `graphql_schema`/`graphql_query`/`graphql_mutate` and/or persisted operations as typed tools; OAuth resource server + scopes; runs through `graxia.execute`                                                                                                                                                                                   | peer core; `@modelcontextprotocol/sdk`                         |
| `@graxia/envelop`  | `fromEnvelop(plugins)` → one graxia plugin                                                                                                                                                                                                                                                                                                                                    | peer core, `@envelop/core`                                     |

Repo extras: `plugins/graxia/` (plugin.json without version, skill `use-graxia`, generated `references/packages.md`, agent `graxia-upgrade-assistant`); `scripts/plugin-index.ts`, `scripts/llms.ts` generating `llms.txt`/`llms-full.txt` (spec fails when stale).

## 2. Core API sketch

```ts
const schema = createSchema<AppContext>()({ typeDefs, resolvers }); // or any GraphQLSchema
const graxia = createGraxia({
  schema, path: '/graphql' /* false: host routes */, env,
  context: async ({ request, serverContext }) => ({ user: await auth(request) }),
  plugins: [],
  limits: { tokens: 15_000, nesting: 1_000, depth: 12, aliases: 30, directives: 50, rootFields: 20, cost: { max: 5_000 }, bodyBytes: 1 << 20, batch: false },
  csrf: { requireHeader: true, sameOrigin: undefined },
  introspection: 'development',
  trustedDocuments: { manifest, store, apq: true, mode: 'strict' },
  errors: { mask: 'production', onUnexpected },
  caches: { parse: { maxBytes, max, ttlMs }, validation: {} },
  subscriptions: { sse: true, ws: { keepAliveMs: 12_000, maxPayloadBytes, connectionInitWaitMs }, pubsub },
  incremental: true, telemetry: { instance, resolverSpans: false }, executor, shutdown: AbortSignal,
});
graxia.fetch(request, serverContext?): Promise<Response>;
graxia.upgrade(request, server, serverContext?): boolean;
graxia.websocket: Bun.WebSocketHandler;
graxia.execute({ query | documentId, variables, operationName }, serverContext?, { signal }): Promise<ExecutionResult | AsyncIterable>;
graxia.serve(options?): Bun.Server;  graxia.dispose(): Promise<void>;  getContext<C>(): C;
```
Plugin: `{ name, enforce?: 'pre'|'post', setup?, onRequest?, onParams?, onParse?, onValidate?, onContext? (typed extend), onExecute?, onSubscribe?, onResultChunk?, onResponse? }`; `createStateKey<T>(name)`; `definePlugin({...})` (or `definePlugin<In>()({...})` when it requires context) infers additions; compile-time "schema context provided" check.
Errors: `exposedError(code, message, { extensions?, fix? })` with typed code map; anything else → `Unexpected error.` + `INTERNAL_SERVER_ERROR` + `correlationId` in prod; `originalError` never serialized.

## 3. Request lifecycle

1. fetch: path/method; explorer page for browser GET text/html when enabled.
2. onRequest: CSRF, sameOrigin, request id (client `x-request-id` never trusted/echoed), OTel span; may `respond`.
3. Streamed body read: 413 past limit (keeps plugin headers), 415 non-JSON (multipart only with uploads), batching refused unless on.
4. onParams: trusted documents (documentId, APQ hash, manifest); strict refuses arbitrary.
5. Parse: token/nesting pre-scan → weighted LRU cache → `parse`; failure `GRAPHQL_PARSE_FAILED` 400.
6. Validate: cache by schema+doc hash; spec rules + limits; introspection off and suggestions stripped in prod.
7. Operation: GET mutation 405; type/name reported.
8. Context: serverContext → `context` → onContext; under ALS; signal = request ∪ shutdown ∪ socket close → graphql `abortSignal`.
9. onExecute/onSubscribe: `experimentalExecuteIncrementally` / `subscribe`, replaceable.
10. Chunks: onResultChunk → masking → encoding (graphql-response+json / json / multipart / SSE / WS).
11. onResponse; streams end on abort or dispose.
    WS: upgrade → connection_init (onConnect, connectionParams → context) → steps 4–10 per subscribe → close.

## 4. Slices (one PR each, Conventional Commits, changeset)

### M0 Skeleton

- **S0** repo skeleton from nxgt-data (lay-out-a-library-monorepo), five private empty packages, `ci.yml` (one light job on pull_request: lint, build, typecheck via `bun check`, affected tests, verify:artifacts, changeset status), `publish.yml` (tags `v*`, `NPM_TOKEN`), AGENTS.md declaring divergences, CLAUDE.md pointer, `plugins/graxia` stub. Accept: install/lint/build/typecheck/test/verify:artifacts green on empty packages.
### M1 HTTP core

- **S1** plugin engine + types (order, short-circuit, after-hooks, state keys, context merging; type tests).
- **S2** `createSchema` (SDL + typed resolvers, optional codegen `Resolvers`).
- **S3** parse/validation pipeline (token/nesting pre-scan 15 000/1 000, stack overflow → parse failure, weighted LRU 64 MiB/1 024/1 h, validation cache, onParse/onValidate).
- **S4** GraphQL over HTTP (GET/POST, negotiation, status codes, 405, streamed 413, 415, opt-in batching, request id, `serve()`). Accept: graphql-http serverAudits MUST+SHOULD green against real Bun.serve.
- **S5** context + cancellation (ALS `getContext`, serverContext, one context per operation, abortSignal, `shutdown`, `dispose()` drain; ALS benchmark in PR).
- **S6** errors (masking + correlation id, `exposedError` typed codes + `fix`, `onUnexpected`).
- **S7** `graxia.execute` + `@graxia/core/testing` client (GET, POST, headers, persisted hash, typed documents, status).
- **S8** core docs + roadmap; first publish `@graxia/core` 0.1.0.
### M2 Subscriptions & incremental

- **S9** PubSub typed interface + memory impl, filter/map, abort-safe.
- **S10** SSE (graphql-sse distinct connections, GET/POST, 12 s keep-alive, cancel on abort/dispose; graphql-sse client tests). Note (S6): every payload goes through `rt.maskResult`, after `onResultChunk`.
- **S11** @defer/@stream over multipart/mixed and SSE; onResultChunk. Note (S5): a streamed body must be tracked by the lifecycle (so `dispose()` drains it), aborted by the shutdown signal, and have ALS wrapped around its async iterator. Note (S6): each incremental payload goes through `rt.maskResult`, after `onResultChunk`.
- **S12** graphql-transport-ws on Bun WebSocket (close codes 4400/4401/4403/4408/4409/4429, onConnect, connectionParams, keep-alive, maxPayloadBytes, 1001 on dispose, `upgrade()`); graphql-ws client interop. Note (S5): sockets and their streams follow the same rule as S11 (lifecycle tracking, shutdown abort, ALS around the iterator). Note (S6): every `next` payload goes through `rt.maskResult`, after `onResultChunk`.
- **S13** `@graxia/redis` (pubsub + cache, reconnect/resubscribe); publish 0.2.
### M3 Security, trusted documents, OTel

- **S14** operation limits (depth, aliases, directives, root fields, cost `@cost`/`@listSize`), codes + limit + `fix`.
- **S15** CSRF (Yoga semantics, custom headers), sameOrigin (null refused, allow/json/refuse, 403 no-store), introspection/suggestions off in prod.
- **S16** trusted documents (Relay/codegen/plain manifests, APQ errors, documentId, strict `PERSISTED_QUERY_ONLY`, key extractor, KeyValueCache store) over HTTP, SSE, WS, execute.
- **S17** `fieldRateLimit` (aliases/fragments, single, consume(key,cost), limitFromStore, ipv6Prefix, 429 Retry-After, custom code).
- **S18** OpenTelemetry (request/parse/validate/execute spans, optional resolver spans, no-op without peer; in-memory exporter tests).
- **S19** production profile spec + `docs/guide/production.md`; publish 0.3.
### M4 Explorer

- **S20** `@graxia/graphiql` (Bun.build bundle, hashed immutable assets, config in data- attribute, CSP `script-src 'self'`, dev only; no external URLs; asset resolution from packed tarball).
- **S21** Apollo Sandbox option (exact Apollo hosts in CSP, dev-only, documented); publish 0.4.
### M5 MCP & AI

- **S22** `@graxia/core/agent` (`@needs`, `@constraint`, `@errors` directives; `printSchemaFor(schema, { can })`; `lintDescriptions`; `fix` on errors).
- **S23** `@graxia/mcp` Streamable HTTP + generic tools (mutation refused in graphql_query).
- **S24** OAuth (RFC 9728 metadata, WWW-Authenticate, verifyToken, scopes mcp:read/mcp:write, principal in context).
- **S25** persisted operations as typed tools (JSON Schema from variables, output schema, required descriptions).
- **S26** Claude Code plugin + llms.txt generation (stale-file specs); publish 0.5.
### M6 Envelop & alxia parity

- **S27** `@graxia/envelop` (`fromEnvelop`, setParseFn/setExecuteFn/setSubscribeFn; tested with depth-limit, generic-auth, response-cache, persisted-operations on graphql 17).
- **S28** multipart uploads (off by default, own byte limit, Bun FormData File, CSRF enforced).
- **S29** parity suite + `examples/host-embedding` (external router, context, upgrade, shutdown); publish 0.6 → `@alxia/graphql` may start its major.

## 5. Parity checklist vs @alxia/graphql 0.16.4

1 host `fetch(request, serverContext)`, any path/prefix · 2 typed host context + `context` option + compile-time check · 3 resolvers set headers/cookies · 4 maxTokens 15 000 / maxNesting 1 000, stack overflow caught · 5 weighted parse cache + validation cache · 6 body limit 1 MiB, 413 keeps plugin headers · 7 415 non-JSON · 8 CSRF custom headers · 9 sameOrigin full semantics · 10 persisted operations (strict, sha256Hash, custom key, error codes) · 11 depth limit · 12 introspection off outside dev · 13 masked errors, originalError stripped · 14 batching off / `{ limit }` · 15 SSE GET+POST 12 s keep-alive · 16 multipart incremental · 17 streams ended on shutdown · 18 graphql-ws on same path via host upgrade, connectionParams, keep-alive or false, 1001, drain · 19 per-operation reporting (HTTP, batch, WS) · 20 request id never trusted, quiet logs · 21 GraphiQL dev-only, Apollo Sandbox, CSP per page, renderSandbox equivalent · 22 fieldRateLimit full · 23 in-process executor with signal · 24 test client · 25 CORS off (host owns it) · 26 Envelop plugins via adapter · 27 multipart uploads · 28 one stable context per operation · 29 abort signal to subscription resolvers · 30 configurable WS message limit · 31 actionable missing-peer errors · 32 host shutdown signal · 33 graphql 16 dropped (why alxia's switch is a major).

## 6. Risks

- R1 graphql 17 ecosystem (envelop, graphql-tools, graphql-ws, graphql-sse peer 16): protocols written in-house, clients dev-only; adapter docs list tested plugins.
- R2 incremental response format (17's pending/incremental/completed; client support varies; may still change): pin ^17, incremental specs on every bump.
- R3 GraphiQL 4 under strict CSP (inline styles → `style-src 'unsafe-inline'`), GraphiQL 4 in maintenance, 3–5 MB bundle.
- R4 Redis pub/sub reconnect: solved by `@softistx/redis`'s shared, reconnecting raw subscriber.
- R5 ALS overhead on Bun: measure in S5; explicit context stays primary.
- R6 MCP spec/SDK churn: pin SDK, track spec revision.

## Reference files

`@alxia/graphql` 0.16.4 sources and production guide; the repository skeleton follows the nxgt library monorepo layout.
