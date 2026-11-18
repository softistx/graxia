---
name: use-graxia
description: >-
  Wire and use graxia, the Bun-native GraphQL server engine, in an application:
  install @graxia/core and its graphql 17 peer, and respect the contracts the
  package states. This is the index: the package ships the detail. Use when an
  app depends on @graxia/core or adds a GraphQL server on Bun.
---

# Use graxia

`@graxia/core` 0.1.0 ships GraphQL over HTTP (`createGraxia`, `fetch`, `serve`),
typed plugins, per-operation context and cancellation, error masking
(`exposedError`) and in-process `execute` with a test client
(`@graxia/core/testing`). Its peer is `graphql ^17.1.0`.

The detail lives in the installed package: `node_modules/@graxia/core/README.md`
and `node_modules/@graxia/core/docs/`. This skill points at it and never copies
it. Security is limited in 0.1.0 (no CSRF prevention, introspection control or
operation limits): read the README's "Security in 0.1.0" first. Subscriptions,
incremental delivery, trusted documents, OpenTelemetry and the other packages
are planned: `node_modules/@graxia/core/docs/roadmap.md` says what is next.
`references/packages.md` is the package index.
