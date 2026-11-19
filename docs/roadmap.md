# Roadmap

Where graxia is going, as what you get. A direction, not a commitment.

## Now

- **Telemetry on `@softistx/telemetry`** — the optional peer `@opentelemetry/api` is replaced by the
  in-house `@softistx/telemetry`, with the same spans and attributes
  ([#67](https://github.com/softistx/graxia/issues/67)).
- **A built-in explorer** (M4) — GraphiQL 4 bundled with no CDN under a strict
  content security policy ([#21](https://github.com/softistx/graxia/issues/21), done), and an Apollo Sandbox option
  ([#22](https://github.com/softistx/graxia/issues/22), done), both development-only.

## Later

- **Ready for agents** (M5) — an MCP server over Streamable HTTP with schema,
  query and mutation tools, OAuth, persisted operations as typed tools, a
  schema printer that shows an agent what it may do, `llms.txt` and a Claude Code
  plugin.
- **Envelop and migration** (M6) — run Envelop plugins unchanged, multipart
  uploads, and a parity suite so applications on `@alxia/graphql` can move to
  graxia.

## Not planned

- Node or Deno adapters; graxia is Bun only.
- graphql 16 support.
- A code-first schema builder in v1: bring any `GraphQLSchema`, or use SDL with
  typed resolvers.

## Shipped

- **A repository you can build on** (M0) — five packages, a green build, type
  check, test and artifact check.
- **A GraphQL endpoint on `Bun.serve`** (M1, in `@graxia/core` 0.1.0) —
  `createGraxia({ schema })` gives you `fetch`, GraphQL over HTTP that passes the
  graphql-http audit, a typed plugin system with ordered hooks and per-request
  state, parse and validation caches, per-request context with cancellation,
  masked errors with typed codes, and an in-process `execute` with a test client.
- **Subscriptions and incremental delivery** (M2, in `@graxia/core` 0.2.0 and
  `@graxia/redis` 0.1.0) — a typed PubSub, subscriptions over SSE and
  graphql-transport-ws on Bun's WebSocket, `@defer` and `@stream` over
  `multipart/mixed` and SSE, a key-value cache contract, and Redis PubSub and cache
  on Bun's Redis client.
- **Secure by default** (M3, in `@graxia/core` 0.3.0 and `@graxia/redis` 0.1.1) — operation
  limits (depth, aliases, cost with `@cost` / `@listSize`), CSRF prevention and a WebSocket
  `Origin` check, introspection and suggestions off in production, trusted documents (manifests,
  `documentId`, automatic persisted queries, strict mode), `fieldRateLimit`, spans on `@opentelemetry/api`
  and a production guide.
