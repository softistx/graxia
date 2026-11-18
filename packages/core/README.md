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

- [Plugins](./docs/guide/plugins.md): hooks, ordering, short-circuit, request state, typed context.

See [`docs/`](./docs) for the guides, troubleshooting and roadmap of this package.
