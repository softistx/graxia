# Roadmap

Where graxia is going, as what you get. A direction, not a commitment.

## Now

- **Subscriptions and incremental delivery** (M2) — SSE and
  graphql-transport-ws on Bun's WebSocket, `@defer` and `@stream`, a typed PubSub
  with an in-memory implementation, and Redis PubSub and cache in `@graxia/redis`
  (coming in the next release).

## Next

- **Secure by default** (M3) — operation limits (depth, aliases, cost), CSRF and
  same-origin checks, introspection off in production, trusted documents (manifest
  and automatic persisted queries, strict mode), a field rate limit and
  OpenTelemetry spans.

## Later

- **A built-in explorer** (M4) — GraphiQL 4 bundled with no CDN under a strict
  content security policy, and an Apollo Sandbox option, both development-only.
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
