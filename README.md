# graxia

A Bun-native GraphQL server engine: typed plugins, graphql 17 and GraphQL over HTTP.
`@graxia/core` ships the HTTP transport, plugins, context and cancellation, error masking,
subscriptions over server-sent events and WebSocket, `@defer` and `@stream`, a typed PubSub, a
key-value cache contract, in-process `execute` and a test client. `@graxia/redis` swaps the PubSub
and the cache for Redis and adds a shared field rate limit. Trusted documents (manifests, `documentId`, automatic persisted queries, strict mode) are built; telemetry runs on `@softistx/telemetry` (optional peer), and `@graxia/mcp` serves it to agents over MCP.

> Status: `@graxia/core`, `@graxia/redis`, `@graxia/graphiql` and `@graxia/mcp` are public on npm;
> `@graxia/envelop` is not published yet. See the [roadmap](docs/roadmap.md) and the [plan](docs/plan.md).

| package                                 | what it is                                                     |
| --------------------------------------- | -------------------------------------------------------------- |
| [`@graxia/core`](packages/core)         | the engine                                                     |
| [`@graxia/redis`](packages/redis)       | Redis PubSub, cache and field rate limit, on `@softistx/redis` |
| [`@graxia/graphiql`](packages/graphiql) | GraphiQL and Apollo Sandbox                                    |
| [`@graxia/mcp`](packages/mcp)           | MCP server (Streamable HTTP, schema, query and mutate tools)   |
| [`@graxia/envelop`](packages/envelop)   | Envelop plugin adapter (`fromEnvelop`)                         |

For agents: [`llms.txt`](llms.txt) indexes the docs of every package, [`llms-full.txt`](llms-full.txt) holds them in full.

Requires Bun 1.4 and `graphql@^17.1`. MIT licensed.
