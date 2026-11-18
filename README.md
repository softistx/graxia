# graxia

A Bun-native GraphQL server engine: typed plugins, graphql 17, GraphQL over HTTP, SSE and
WebSocket, `@defer`/`@stream`, trusted documents, OpenTelemetry and an MCP server.

> Status: scaffold, nothing is published yet. See the [roadmap](docs/roadmap.md) and the
> [plan](docs/plan.md).

| package                                 | what it is                  |
| --------------------------------------- | --------------------------- |
| [`@graxia/core`](packages/core)         | the engine                  |
| [`@graxia/redis`](packages/redis)       | Redis PubSub and cache      |
| [`@graxia/graphiql`](packages/graphiql) | GraphiQL and Apollo Sandbox |
| [`@graxia/mcp`](packages/mcp)           | MCP server                  |
| [`@graxia/envelop`](packages/envelop)   | Envelop plugin adapter      |

Requires Bun 1.4 and `graphql@^17`. MIT licensed.
