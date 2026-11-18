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
`KeyValueCache` (`createMemoryCache`). `@graxia/redis` implements the PubSub and
the cache on Bun's Redis client (`redisPubSub`, `redisCache`). The peer of core
is `graphql ^17.1.0`.

The detail lives in the installed packages: `node_modules/@graxia/core/README.md`
and `node_modules/@graxia/core/docs/` (guides: `subscriptions.md` for SSE,
`websocket.md` for `graphql-transport-ws`, `incremental.md` for `@defer` and
`@stream`, `pubsub.md`, `limits-and-caches.md`), and
`node_modules/@graxia/redis/docs/guide/redis.md`. This skill points at them and
never copies them. Security is limited (no CSRF prevention, no WebSocket
`Origin` check, introspection control or operation limits): read the README's
"Security" first; a cookie-authenticated browser app must check `Origin` on the
WebSocket upgrade. Trusted documents, OpenTelemetry and the other packages are
planned: `node_modules/@graxia/core/docs/roadmap.md` says what is next.
`references/packages.md` is the package index.
