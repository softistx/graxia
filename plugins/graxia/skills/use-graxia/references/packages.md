# graxia packages

| package         | status                                                                                                                                                                                                            |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@graxia/core`  | 0.3.0: plugins, GraphQL over HTTP, SSE and WebSocket subscriptions, `@defer` / `@stream`, typed PubSub and `KeyValueCache`, context and cancellation, errors and masking, `execute` and a test client; secure by default (CSRF header, WebSocket `Origin` check, introspection and suggestions off in production), operation limits and `@cost` / `@listSize`, trusted documents and APQ, `fieldRateLimit`, OpenTelemetry spans |
| `@graxia/redis` | 0.1.0: `redisPubSub` and `redisCache` on Bun's Redis client; peer `@graxia/core`; docs in `node_modules/@graxia/redis/docs/`                                                                                      |

The other packages (explorers, an MCP server, an Envelop adapter) are planned, not released: see
`node_modules/@graxia/core/docs/roadmap.md`.
