# @graxia/mcp

A Model Context Protocol server for a [graxia](https://github.com/softistx/graxia) API. An agent
(Claude, an IDE, any MCP client) connects over Streamable HTTP, reads the schema it is allowed to
see, and runs GraphQL operations through your server, with every graxia protection on: limits,
cost, trusted documents, error masking and rate limits.

> Without `auth` there is no authentication here: put the endpoint behind your own, or set `auth`
> to make it an OAuth resource server ([guide](./docs/guide/auth.md)). `can` decides which fields
> a caller sees. See [security](./docs/guide/security.md).

## Install

```sh
bun add @graxia/mcp @graxia/core graphql
```

Requires Bun 1.4.4 or later and `@graxia/core` 0.5 or later.

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

| tool             | listed                                                   | what it does                                                                              |
| ---------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `graphql_schema` | always                                                   | operations and type names; `{ types }` gives SDL, `{ search }` finds types by a word      |
| `graphql_query`  | always (not in strict trusted-documents mode)            | runs a query; mutations, subscriptions, introspection, `@defer` and `@stream` are refused |
| `graphql_mutate` | `mutations: true` (not in strict trusted-documents mode) | runs a mutation; a query is refused                                                       |

With `operations`, each persisted operation is one more tool (`book_by_id`), with typed arguments:
see [typed tools](#typed-tools).

Every tool answers with the GraphQL result as `structuredContent` (and its JSON as text); every
error carries `extensions.code` and `extensions.fix`. Details: [the tools guide](./docs/guide/tools.md).

## Options

```ts
createMcp(graxia, {
	name: 'library', // serverInfo.name (required)
	version: '1.0.0', // serverInfo.version, default '0.0.0'
	instructions: 'Books and loans.', // shown to the model
	can: async (request, serverContext, auth) => (permission) =>
		permissions.has(permission), // auth: the verified token, with `auth` set
	auth: {
		// an OAuth resource server: see the auth guide
		resource: 'https://mcp.example.com/mcp',
		authorizationServers: ['https://auth.example.com'],
		scopes: { read: 'mcp:read', write: 'mcp:write' }, // default
		resourceName: 'Library', // shown by the metadata
		documentation: 'https://docs.example.com/mcp', // `resource_documentation`
		verifyToken: async (token, request) => verify(token), // McpAuthInfo | Response | undefined
		audience: 'resource', // default: the info's audience must contain `resource`
	},
	mutations: true, // list graphql_mutate and the mutation typed tools, default false
	operations: {
		// persisted operations as typed tools: see the operations guide
		documents: manifest, // core's TrustedManifest: codegen or Relay object, Apollo manifest, Map
		include: (operation) => operation.kind === 'query', // { name, kind, id } => boolean
		descriptions: { BookById: 'Find a book by its id.' }, // by operation name; wins over the document's
	},
	genericTools: false, // only graphql_schema and the typed tools, default true
	allowedOrigins: ['https://app.example'], // browser origins: CORS and the origin check
	allowedHosts: ['mcp.example.com'], // hostnames of the endpoint, default localhost
	onError: (error) => logger.error(error), // default console.error
});
```

## Typed tools

```ts
import { createGraxia } from '@graxia/core';
import { createMcp } from '@graxia/mcp';
import manifest from './persisted-documents.json';

// In the manifest: """Find a book by its id.""" query BookById($id: ID!) { book(id: $id) { id title } }
const graxia = createGraxia({ schema, trustedDocuments: { manifest } });
const mcp = createMcp(graxia, {
	name: 'library',
	operations: { documents: manifest },
});
```

Each named query of the manifest is a tool (`BookById` → `book_by_id`; mutations with
`mutations: true`; subscriptions are skipped) whose input schema comes from the operation's
variables (types, defaults, `@constraint`) and whose output schema comes from its selection set. The
agent sends arguments, not GraphQL. With trusted documents in `strict` mode these are the only tools
that run operations: `graphql_query` and `graphql_mutate` are not listed and refuse a call. Every
operation needs a description (`"""…"""` above it, or `descriptions`); `createMcp` throws one error
listing every problem of the manifest, each with its fix. See
[the operations guide](./docs/guide/operations.md).

## OAuth

```ts
import { createGraxia } from '@graxia/core';
import { createMcp, mcpAuth } from '@graxia/mcp';

// `schema` is the one from the core quick start. `verifyJwt` is your token check (signature and
// issuer): it resolves the claims, and must resolve undefined for a bad token, not throw
// (a throw is an outage: a 503 the client retries).
const graxia = createGraxia({
	schema,
	context: () => ({ userId: mcpAuth()?.subject }), // the verified token, in a tool call
});
const mcp = createMcp(graxia, {
	name: 'library',
	mutations: true,
	auth: {
		resource: 'https://api.example.com/mcp', // the public URL of the endpoint
		authorizationServers: ['https://auth.example.com'],
		verifyToken: async (token) => {
			const claims = await verifyJwt(token);
			if (!claims) return undefined; // a 401
			return {
				subject: claims.sub,
				scopes: claims.scope.split(' '),
				expiresAt: claims.exp, // seconds
				audience: claims.aud, // must contain `resource`
			};
		},
	},
});

Bun.serve({
	routes: {
		[mcp.metadataPath]: mcp.metadata, // RFC 9728 metadata
		'/mcp': (request, server) => mcp.fetch(request, { server }),
	},
	fetch: graxia.fetch,
});
```

A request without a valid bearer token with `mcp:read` is a 401 with a `WWW-Authenticate`
challenge pointing at the metadata; `graphql_mutate` and the mutation typed tools need `mcp:write`. The token's audience is
checked against `resource` unless `audience: 'verifier'` says your verifier did it; a verifier
that throws is a 503, and it may resolve its own `Response`. Bearer only, no DPoP. See
[the auth guide](./docs/guide/auth.md).

## Documentation

See [`docs/`](./docs): [getting started](./docs/guide/getting-started.md), [auth](./docs/guide/auth.md), [tools](./docs/guide/tools.md),
[typed tools](./docs/guide/operations.md),
[security](./docs/guide/security.md), [troubleshooting](./docs/troubleshooting.md)
([auth errors](./docs/troubleshooting-auth.md)) and the
[roadmap](./docs/roadmap.md). The schema and the body limit come from the graxia instance
(`graxia.schema`, `graxia.limits`, core 0.5).
