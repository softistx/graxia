---
name: use-graxia
description: >-
  Wire and use graxia, the Bun-native GraphQL server engine, in an application:
  install @graxia/core and its graphql 17 peer, and respect the contracts the
  package states. This is the index: the package ships the detail. Use when an
  app depends on @graxia/core or adds a GraphQL server on Bun.
---

# Use graxia

`@graxia/core` ships GraphQL over HTTP (`createGraxia`, `fetch`, `serve`),
typed plugins, per-operation context and cancellation, error masking
(`exposedError`), in-process `execute` with a test client
(`@graxia/core/testing`), subscriptions over server-sent events and WebSocket
(`graphql-transport-ws`, both on by default), `@defer` and `@stream` over
`multipart/mixed` and SSE, a typed `PubSub` (`createMemoryPubSub`) and a
`KeyValueCache` (`createMemoryCache`). Since 0.3.0 it is also secure by default
and production-ready: CSRF prevention and a WebSocket `Origin` check, operation
limits (depth, aliases, directives, root fields, `@cost` / `@listSize` cost),
introspection and suggestions off under `NODE_ENV=production`, trusted
documents (manifests, `documentId`, APQ, strict mode), `fieldRateLimit`, and
OpenTelemetry spans (optional peer `@opentelemetry/api`). `@graxia/redis`
implements the PubSub and the cache on Bun's Redis client (`redisPubSub`,
`redisCache`). The peer of core is `graphql ^17.1.0`.

The detail lives in the installed packages: `node_modules/@graxia/core/README.md`
and `node_modules/@graxia/core/docs/` (guides: `security.md`,
`limits-and-caches.md`, `trusted-documents.md`, `rate-limiting.md`,
`telemetry.md`, `production.md`, `subscriptions.md` for SSE, `websocket.md` for
`graphql-transport-ws`, `incremental.md` for `@defer` and `@stream`,
`pubsub.md`), and `node_modules/@graxia/redis/docs/guide/redis.md`. This skill
points at them and never copies them. Read `security.md` and `production.md`
before shipping.

Breaking defaults to know when adopting 0.3.0 (the changesets say how to turn
each off):

- a `GET` or a non-JSON `POST` needs a CSRF header, otherwise 403
  `CSRF_HEADER_REQUIRED` (this includes a browser `EventSource`);
- a WebSocket upgrade from another `Origin` is 403 `FORBIDDEN_ORIGIN` unless
  listed in `csrf.sameOrigin.allowedOrigins`;
- operations over depth 12, 30 aliases, 50 directives, 20 root fields or cost
  5 000 are refused;
- under `NODE_ENV=production` introspection and "Did you mean" hints are off,
  and trusted documents (when configured) are `strict`.

`node_modules/@graxia/core/docs/roadmap.md` says what is next.
`references/packages.md` is the package index.
