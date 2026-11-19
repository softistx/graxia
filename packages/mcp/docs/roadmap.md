# Roadmap

Where `@graxia/mcp` is going, as what you get. A direction, not a commitment.

## Now

- **Streamable HTTP and the generic tools** — `createMcp(graxia, { name })` with
  `graphql_schema`, `graphql_query` and, on request, `graphql_mutate`, with an origin and host
  check, CORS for allowed origins and graxia's limits and codes on every refusal.

## Next

- **OAuth resource server** — protected resource metadata, `WWW-Authenticate`, `verifyToken`,
  `mcp:read` and `mcp:write` scopes, and the principal in the context.
- **Persisted operations as typed tools** — an agent calls named tools with typed arguments instead
  of sending documents, which also works under strict trusted documents.

## Not planned

- Stateful sessions and a server-to-client stream.
- Subscriptions over MCP.
