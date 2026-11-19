---
"@graxia/mcp": minor
---

First public release of `@graxia/mcp`: `createMcp(graxia, { schema, name })`, a stateless Streamable HTTP MCP server on the Web `Request`/`Response` pair, with the tools `graphql_schema` (overview, `types`, `search`), `graphql_query` and, with `mutations: true`, `graphql_mutate`. Operations are validated against the schema the caller may see (`can`) and run through `graxia.execute`. An `Origin` check, a body size cap and a `fix` on every refusal.
