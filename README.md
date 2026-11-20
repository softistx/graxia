# graxia

A Bun-native GraphQL server engine: typed plugins, graphql 17 and GraphQL over HTTP.
`@softistx/graxia` ships the HTTP transport, plugins, context and cancellation, error masking,
subscriptions over server-sent events and WebSocket, `@defer` and `@stream`, a typed PubSub, a
key-value cache contract, in-process `execute` and a test client. `@softistx/graxia-redis` swaps the PubSub
and the cache for Redis and adds a shared field rate limit. Trusted documents (manifests, `documentId`, automatic persisted queries, strict mode) are built; telemetry runs on `@softistx/telemetry` (optional peer), and `@softistx/graxia-mcp` serves it to agents over MCP.

> Status: `@softistx/graxia`, `@softistx/graxia-redis`, `@softistx/graxia-graphiql`, `@softistx/graxia-mcp` and `@softistx/graxia-envelop` are public on npm. The packages moved from the `@graxia` scope: see the [migration guide](packages/core/docs/guide/migrating-from-graxia-scope.md). See the [roadmap](docs/roadmap.md) and the [plan](docs/plan.md).

| package                                          | what it is                                                     |
| ------------------------------------------------ | -------------------------------------------------------------- |
| [`@softistx/graxia`](packages/core)              | the engine                                                     |
| [`@softistx/graxia-redis`](packages/redis)       | Redis PubSub, cache and field rate limit, on `@softistx/redis` |
| [`@softistx/graxia-graphiql`](packages/graphiql) | GraphiQL and Apollo Sandbox                                    |
| [`@softistx/graxia-mcp`](packages/mcp)           | MCP server (Streamable HTTP, schema, query and mutate tools)   |
| [`@softistx/graxia-envelop`](packages/envelop)   | Envelop plugin adapter (`fromEnvelop`)                         |

Examples: [`examples/host-embedding`](examples/host-embedding) is an app that owns `Bun.serve` and embeds graxia (prefix, typed host context, cookies, CORS, WebSocket and SSE on one path, graceful shutdown).

For agents: [`llms.txt`](llms.txt) indexes the docs of every package, [`llms-full.txt`](llms-full.txt) holds them in full.

Requires Bun 1.4 and `graphql@^17.1`. MIT licensed.
