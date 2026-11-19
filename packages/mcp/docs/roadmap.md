# Roadmap

Where `@graxia/mcp` is going, as what you get. A direction, not a commitment.

## Now

- **Streamable HTTP and the generic tools** — `createMcp(graxia, { name })` with
  `graphql_schema`, `graphql_query` and, on request, `graphql_mutate`, with an origin and host
  check, CORS for allowed origins and graxia's limits and codes on every refusal.

- **OAuth resource server** — protected resource metadata (`mcp.metadata`), `WWW-Authenticate`
  challenges, `verifyToken`, `mcp:read` and `mcp:write` scopes with step-up, and the principal in
  `can` and `mcpAuth()`.

- **Persisted operations as typed tools** — `operations: { documents: manifest }` turns each
  persisted query (and mutation, on request) into a tool with a JSON Schema for its arguments and
  its result; it works under strict trusted documents, and `genericTools: false` offers nothing else.

## Not planned

- Stateful sessions and a server-to-client stream.
- Subscriptions over MCP.
