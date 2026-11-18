# Roadmap

Where `@graxia/core` is going, as what you get. A direction, not a commitment.

## Now

- **Subscriptions over SSE and WebSocket** — `subscribe` operations over server-sent events and
  `graphql-transport-ws` on Bun's WebSocket, with a typed PubSub and an in-memory implementation.

## Next

- **`@defer` and `@stream`** — incremental delivery over HTTP, tracking graphql 17.
- **Redis PubSub and cache** — a separate `@graxia/redis` package on Bun's built-in Redis client,
  so subscriptions and caches work across several instances.

## Later

- **Secure by default** — none of this is in 0.1.0 (see "Security in 0.1.0" in the README):
  operation limits (depth, aliases, cost), CSRF prevention and same-origin checks, an
  introspection policy (off in production), trusted documents (manifest and automatic persisted queries),
  and a field rate limit.
- **OpenTelemetry** — spans for each stage of an operation.
- **A built-in explorer** — GraphiQL, bundled with no CDN and development-only.
- **Ready for agents** — an MCP server over Streamable HTTP exposing your schema and persisted
  operations as tools.
- **Parity and migration** — run Envelop plugins unchanged, multipart uploads, and a parity suite
  so an application on another GraphQL server can move over.

## Not planned

- Node or Deno adapters; graxia is Bun only.
- graphql 16 support.
- A code-first schema builder in v1: bring any `GraphQLSchema`, or use SDL with typed resolvers.

## Shipped

### 0.1.0

- **A typed plugin engine** — `definePlugin`, ordered hooks (`enforce: "pre" | "post"`) with
  after-hooks, short-circuit helpers, typed per-request state and typed context extension.
- **`createSchema`** — a `GraphQLSchema` from SDL and typed resolvers: merged arrays, custom
  scalars, enum values, `__resolveType`, `extend type`, optional codegen resolver types.
- **A parse and validation pipeline with caches** — token and nesting limits, a weighted LRU parse
  cache and a per-schema validation cache.
- **GraphQL over HTTP** — `createGraxia` with `fetch` and `serve`, GET and POST, content
  negotiation, correct status codes, a body size limit, opt-in batching and a request id; passes the `graphql-http`
  server audits.
- **Readiness** — `graxia.ready` resolves once every plugin's `setup` has completed and rejects
  when one fails, so a host can wait before it serves.
- **Context and cancellation** — one context per operation, `getContext()`, a `signal` that aborts
  on client disconnect or shutdown, and `dispose()` that drains in-flight operations.
- **Errors and masking** — `exposedError` with typed codes, unexpected errors masked with a
  correlation id, `maskError`, `maskErrors` and `onUnexpected`.
- **`execute` and testing** — in-process `graxia.execute`, typed documents, and the
  `@graxia/core/testing` client with `expectNoErrors`.
