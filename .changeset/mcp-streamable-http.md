---
"@graxia/mcp": minor
---

First public release of `@graxia/mcp`: `createMcp(graxia, { name })`, a stateless Streamable HTTP MCP server on the Web `Request`/`Response` pair (the schema and the body limit come from `graxia.schema` and `graxia.limits`), with the tools `graphql_schema` (overview, `types`, `search`), `graphql_query` and, with `mutations: true`, `graphql_mutate`. Operations are validated against the schema the caller may see (`can`; introspection is refused) and run through `graxia.execute`, whose codes and fixes reach the agent. DNS-rebinding guard (`Origin` and `Host`, `allowedHosts`), CORS for `allowedOrigins`, a body size cap, `onError`, and a `fix` on every refusal.

OAuth resource server: `auth: { resource, authorizationServers, verifyToken }` makes every request need a bearer token with `mcp:read` (401 and 403 `WWW-Authenticate` challenges with `resource_metadata`, an `access_token` in the query refused, expiry and audience checked), `graphql_mutate` listed and callable only with `mcp:write` (a read-only call is a 403 step-up), the RFC 9728 metadata at `mcp.metadataPath` (`mcp.metadata`), the verified token as `can`'s third argument and `mcpAuth()` for graxia's `context` builder. New codes `MCP_UNAUTHORIZED`, `MCP_INSUFFICIENT_SCOPE` and `MCP_TOKEN_IN_URL`.
