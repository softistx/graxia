# graxia

A Bun-native GraphQL server engine: typed plugins, graphql 17 and GraphQL over HTTP.
`@graxia/core` ships the HTTP transport, plugins, context and cancellation, error masking,
subscriptions over server-sent events and WebSocket, `@defer` and `@stream`, a typed PubSub, a
key-value cache contract, in-process `execute` and a test client. `@graxia/redis` swaps the PubSub
and the cache for Redis. Trusted documents (manifests, `documentId`, automatic persisted queries, strict mode) are built; telemetry runs on `@softistx/telemetry` (optional peer), and an MCP server is planned.

> Status: `@graxia/core` and `@graxia/redis` are public on npm; the other packages are not published
> yet. See the [roadmap](docs/roadmap.md) and the [plan](docs/plan.md).

| package                                 | what it is                                   |
| --------------------------------------- | -------------------------------------------- |
| [`@graxia/core`](packages/core)         | the engine                                   |
| [`@graxia/redis`](packages/redis)       | Redis PubSub and cache on Bun's Redis client |
| [`@graxia/graphiql`](packages/graphiql) | GraphiQL and Apollo Sandbox                  |
| [`@graxia/mcp`](packages/mcp)           | MCP server                                   |
| [`@graxia/envelop`](packages/envelop)   | Envelop plugin adapter                       |

Requires Bun 1.4 and `graphql@^17.1`. MIT licensed.
