# Roadmap

Where `@softistx/graxia-mcp` is going, as what you get. A direction, not a commitment.

## Now

- **Moving to the `@softistx` scope** — the package is now `@softistx/graxia-mcp` (it was `@graxia/mcp`). Same code and API; replace the dependency and the imports ([migration guide](https://github.com/softistx/graxia/blob/develop/packages/core/docs/guide/migrating-from-graxia-scope.md)). The old name is deprecated.
- **Follow-ups from the first release** — sharper refusals: a nesting overflow answers with the fix
  to flatten the query ([#90](https://github.com/softistx/graxia/issues/90)), and `allowedHosts`
  entries are normalised at boot as a request's host is
  ([#93](https://github.com/softistx/graxia/issues/93)).

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
