# graxia

A Bun-native GraphQL server engine: typed plugins, graphql 17 and GraphQL over HTTP.
`@graxia/core` 0.1.0 ships the HTTP transport, plugins, context and cancellation, error masking,
in-process `execute` and a test client. Subscriptions (SSE, WebSocket), `@defer`/`@stream`,
trusted documents, OpenTelemetry and an MCP server are planned.

> Status: `@graxia/core` is the only package in progress; the others are not published yet. See
> the [roadmap](docs/roadmap.md) and the [plan](docs/plan.md).

| package                                 | what it is                                   |
| --------------------------------------- | -------------------------------------------- |
| [`@graxia/core`](packages/core)         | the engine                                   |
| [`@graxia/redis`](packages/redis)       | Redis PubSub and cache on Bun's Redis client |
| [`@graxia/graphiql`](packages/graphiql) | GraphiQL and Apollo Sandbox                  |
| [`@graxia/mcp`](packages/mcp)           | MCP server                                   |
| [`@graxia/envelop`](packages/envelop)   | Envelop plugin adapter                       |

Requires Bun 1.4 and `graphql@^17.1`. MIT licensed.
