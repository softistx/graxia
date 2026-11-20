# Roadmap

Where `@graxia/mcp` is going, as what you get. A direction, not a commitment.

## Now

- **Follow-ups from the first release** — sharper refusals (a nesting overflow answers with the fix
  to flatten the query), and stricter checks of `allowedHosts` at boot.

## Not planned

- Stateful sessions and a server-to-client stream.
- Subscriptions over MCP.

## Shipped

### 0.1.0

- **Streamable HTTP and the generic tools** — `createMcp(graxia, { name })` with
  `graphql_schema`, `graphql_query` and, on request, `graphql_mutate`, with an origin and host
  check, CORS for allowed origins and graxia's limits and codes on every refusal.

- **OAuth resource server** — protected resource metadata (`mcp.metadata`), `WWW-Authenticate`
  challenges, `verifyToken`, `mcp:read` and `mcp:write` scopes with step-up, and the principal in
  `can` and `mcpAuth()`.

- **Persisted operations as typed tools** — `operations: { documents: manifest }` turns each
  persisted query (and mutation, on request) into a tool with a JSON Schema for its arguments and
  its result; under strict trusted documents they are the only tools that run operations, and
  `genericTools: false` offers nothing else.
