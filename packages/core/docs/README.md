# @graxia/core documentation

`@graxia/core` is the Bun-native GraphQL server engine on graphql 17: hand it a schema and get a
`fetch` handler that speaks GraphQL over HTTP, extended through typed plugins. These pages go
deeper than the [npm page](../README.md): each guide covers one area, with examples you can copy.

New here? Read the quick start on the npm page, then [GraphQL over HTTP](./guide/http.md) and
[Plugins](./guide/plugins.md).

## Guides

- [GraphQL over HTTP](./guide/http.md): `createGraxia`, `fetch` / `serve`, status codes, batching, request id.
- [Plugins](./guide/plugins.md): hooks, ordering, short-circuit, request state, typed context.
- [Context, cancellation and shutdown](./guide/context.md): `getContext()`, `signal`, `dispose()`.
- [Schema](./guide/schema.md): `createSchema`, SDL, typed resolvers, codegen resolvers.
- [Subscriptions over SSE](./guide/subscriptions.md): `graphql-sse` distinct connections mode, keep-alive, cancellation, Bun idle timeout.
- [Subscriptions over WebSocket](./guide/websocket.md): `graphql-transport-ws`, `connectionParams` and `onConnect`, close codes, own `Bun.serve`.
- [`@defer` and `@stream`](./guide/incremental.md): multipart/mixed and SSE, formats, clients, masking, cancellation.
- [PubSub](./guide/pubsub.md): typed topics, the in-memory PubSub, `filterIterable` / `mapIterable`, cancellation.
- [Limits and caches](./guide/limits-and-caches.md): parse limits, parse and validation caches, the `KeyValueCache` contract.
- [Security: CSRF, origins, introspection](./guide/security.md): the CSRF header, `sameOrigin`, WebSocket origin, `introspection` and `suggestions`.
- [Trusted documents and persisted queries](./guide/trusted-documents.md): manifests (Relay, codegen, Apollo), `documentId`, APQ, strict mode, error codes.
- [Rate limiting fields](./guide/rate-limiting.md): `fieldRateLimit`, aliases and fragments counted, `single`, keys and IPv6, stores, 429.
- [OpenTelemetry](./guide/telemetry.md): spans for requests, parse, validate and operations, resolver spans, propagation, the optional peer.
- [Production](./guide/production.md): what `NODE_ENV=production` changes, a recommended configuration, proxies, shutdown, health checks and a checklist.
- [Testing: `execute` and the test client](./guide/testing.md): in-process execution, `@graxia/core/testing`.
- [Errors: exposed, masked, correlation ids](./guide/errors.md): `exposedError`, `onUnexpected`, `maskError`.

## Help

- [Troubleshooting](./troubleshooting.md): every error message, why it happens and the fix.

## What is next

- [Roadmap](./roadmap.md): what you get now, what is next and what is not planned.
