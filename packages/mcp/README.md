# @graxia/mcp

A Model Context Protocol server for a [graxia](https://github.com/softistx/graxia) API. An agent
(Claude, an IDE, any MCP client) connects over Streamable HTTP, reads the schema it is allowed to
see, and runs GraphQL operations through your server, with every graxia protection on: limits,
cost, trusted documents, error masking and rate limits.

> **No authentication here yet.** Put the endpoint behind your own auth. `can` decides which
> fields a caller sees; OAuth lands in the next release. See [security](./docs/guide/security.md).

## Install

```sh
bun add @graxia/mcp @graxia/core graphql
```

The packages are ESM, built for Bun, and resolve with `"moduleResolution": "bundler"` in your
`tsconfig.json`. `nodenext` is not supported.

## Mount it

```ts
import { createGraxia } from '@graxia/core';
import { createMcp } from '@graxia/mcp';

// `schema` is the one from the core quick start
const graxia = createGraxia({ schema });
const mcp = createMcp(graxia, {
	name: 'library',
	instructions: 'Books and loans.',
});

Bun.serve({
	routes: { '/mcp': (request, server) => mcp.fetch(request, { server }) },
	fetch: graxia.fetch,
});
```

Point an MCP client at `http://localhost:3000/mcp`. The server is stateless: no session id, `POST`
only (`GET` and `DELETE` answer 405).

## Tools

| tool             | listed            | what it does                                                                              |
| ---------------- | ----------------- | ----------------------------------------------------------------------------------------- |
| `graphql_schema` | always            | operations and type names; `{ types }` gives SDL, `{ search }` finds types by a word      |
| `graphql_query`  | always            | runs a query; mutations, subscriptions, introspection, `@defer` and `@stream` are refused |
| `graphql_mutate` | `mutations: true` | runs a mutation; a query is refused                                                       |

Every tool answers with the GraphQL result as `structuredContent` (and its JSON as text); every
error carries `extensions.code` and `extensions.fix`. Details: [the tools guide](./docs/guide/tools.md).

## Options

```ts
createMcp(graxia, {
	name: 'library', // serverInfo.name (required)
	version: '1.0.0', // serverInfo.version, default '0.0.0'
	instructions: 'Books and loans.', // shown to the model
	can: async (request, serverContext) => (permission) =>
		permissions.has(permission),
	mutations: true, // list graphql_mutate, default false
	allowedOrigins: ['https://app.example'], // browser origins: CORS and the origin check
	allowedHosts: ['mcp.example.com'], // hostnames of the endpoint, default localhost
	onError: (error) => logger.error(error), // default console.error
});
```

## Documentation

See [`docs/`](./docs): [getting started](./docs/guide/getting-started.md), [tools](./docs/guide/tools.md),
[security](./docs/guide/security.md), [troubleshooting](./docs/troubleshooting.md) and the
[roadmap](./docs/roadmap.md). The schema and the body limit come from the graxia instance
(`graxia.schema`, `graxia.limits`, core 0.5).
