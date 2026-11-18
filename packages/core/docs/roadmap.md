# Roadmap

Where `@graxia/core` is going, as what you get. A direction, not a commitment.

## Now

- **Secure by default** — operation limits (depth, aliases, directives, root fields and cost;
  shipped as the operation limits slice), CSRF and same-origin checks (WebSocket upgrades
  included), an introspection policy, trusted documents and a field rate limit, in progress.

## Later

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

### 0.2.0

- **A typed PubSub** — `createMemoryPubSub` with typed topics (template keys included), per-subscriber
  buffers, abort-safe iterators, and `filterIterable` / `mapIterable` (see [the guide](./guide/pubsub.md)).
- **Subscriptions over SSE** — the `graphql-sse` protocol (distinct connections), keep-alives, Bun's
  idle timeout handled (see [the guide](./guide/subscriptions.md)).
- **Subscriptions over WebSocket** — `graphql-transport-ws` on Bun's WebSocket, `connectionParams` and
  `onConnect`, `graxia.upgrade` for your own `Bun.serve` (see [the guide](./guide/websocket.md)).
- **`@defer` and `@stream`** — over `multipart/mixed` and SSE, in graphql 17's format or the legacy one
  (see [the guide](./guide/incremental.md)).
- **A key-value cache contract** — `KeyValueCache` and `createMemoryCache` (LRU with per-entry TTL);
  Redis implementations are in `@graxia/redis`.

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
