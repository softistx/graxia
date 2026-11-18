# @graxia/core

The Bun-native GraphQL server engine: typed plugins, graphql 17, GraphQL over HTTP, SSE, WebSocket, trusted documents, OpenTelemetry.

> Status: scaffold. This package is private and empty until its slice lands; follow the
> [roadmap](../../docs/roadmap.md).

## Install

```sh
bun add @graxia/core graphql@^17
```

The packages are ESM, built for Bun, and resolve with `"moduleResolution": "bundler"` in your
`tsconfig.json`. `nodenext` is not supported.

## Documentation

- [GraphQL over HTTP](./docs/guide/http.md): `createGraxia`, `fetch` / `serve`, status codes, batching, request id.
- [Plugins](./docs/guide/plugins.md): hooks, ordering, short-circuit, request state, typed context.
- [Context, cancellation and shutdown](./docs/guide/context.md): `getContext()`, `signal`, `dispose()`.
- [Errors](./docs/guide/errors.md): `exposedError`, masking, correlation ids, `onUnexpected`.
- [Testing](./docs/guide/testing.md): `graxia.execute`, typed documents, `@graxia/core/testing` client.
- [Schema](./docs/guide/schema.md): `createSchema`, SDL, typed resolvers, codegen resolvers.
- [Limits and caches](./docs/guide/limits-and-caches.md): parse limits, parse and validation caches, `createDocumentPipeline`.

See [`docs/`](./docs) for the guides, troubleshooting and roadmap of this package.
