---
"@graxia/mcp": minor
---

First public release of `@graxia/mcp`: `createMcp(graxia, { name })`, a stateless Streamable HTTP MCP server on the Web `Request`/`Response` pair (the schema and the body limit come from `graxia.schema` and `graxia.limits`), with the tools `graphql_schema` (overview, `types`, `search`), `graphql_query` and, with `mutations: true`, `graphql_mutate`. Operations are validated against the schema the caller may see (`can`; introspection is refused) and run through `graxia.execute`, whose codes and fixes reach the agent. DNS-rebinding guard (`Origin` and `Host`, `allowedHosts`), CORS for `allowedOrigins`, a body size cap, `onError`, and a `fix` on every refusal.
