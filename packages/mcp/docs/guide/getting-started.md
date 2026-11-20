# Getting started

## Install and mount

```sh
bun add @graxia/mcp @graxia/core graphql
```

```ts
import { createGraxia } from '@graxia/core';
import { createMcp } from '@graxia/mcp';

// `schema` is the one from the core quick start
const graxia = createGraxia({ schema });
const mcp = createMcp(graxia, { name: 'library' });

Bun.serve({
	routes: { '/mcp': (request, server) => mcp.fetch(request, { server }) },
	fetch: graxia.fetch,
});
```

`createMcp(graxia, options)` reads the schema and the body limit from the instance
(`graxia.schema`, `graxia.limits.bodyBytes`, `@graxia/core` 0.5), so nothing is given twice. `mcp.fetch(request, serverContext?)` is a Web `Request` in, a
`Response` out, and never rejects. `mcp.dispose()` stops the handler (in-flight requests are aborted),
like `graxia.dispose()`.

**In production.** graxia runs trusted documents in `strict` mode there (`NODE_ENV=production`), so
agents cannot run a document they write: pass `operations: { documents }` to give them your
persisted operations as tools ([typed tools](./operations.md)), or `createMcp` reports it through
`onError` at boot. A hand-made host (a test double) must pass `trustedDocuments:
graxia.trustedDocuments` along with `execute`, `schema` and `limits`.

## Transport

Streamable HTTP, stateless: every `POST` carries one JSON-RPC message or a batch of them and is answered on its own.
There is no `Mcp-Session-Id`. `GET` (the optional server-to-client stream) and `DELETE` (closing a
session) answer 405 with a `fix`, as the spec allows. Only `application/json` bodies are accepted.

## Connect a client

Claude Code:

```sh
claude mcp add --transport http library http://localhost:3000/mcp
```

With `auth` set, give the client its token (`--header "Authorization: Bearer <token>"`) or let its
OAuth support follow the 401 to the metadata ([auth](./auth.md)). Any other client takes the URL as a Streamable HTTP server. In a test, use
`@modelcontextprotocol/client` (`Client` and `StreamableHTTPClientTransport`) against `Bun.serve({ port: 0 })`.

## Host context

`serverContext` is the second argument of `mcp.fetch`, typed like `graxia.fetch`'s (it is required
when your host context has required keys, see core's [context guide](https://github.com/softistx/graxia/blob/develop/packages/core/docs/guide/context.md)). Graxia
merges it into the context of every operation, and `can` receives it:

```ts
Bun.serve({
	routes: {
		'/mcp': (request, server) =>
			mcp.fetch(request, { server, tenant: tenantOf(request) }),
	},
	fetch: (request, server) =>
		graxia.fetch(request, { server, tenant: tenantOf(request) }),
});
```

The request's own headers (an `Authorization`, a cookie) are forwarded to `graxia.execute` too, minus
`Content-Type`, `Content-Length`, `Accept`, `Host`, `Origin` and the `Mcp-*` headers (the
serverContext never travels in a header: a client cannot forge it), so a `context`
that reads them works the same over MCP and HTTP.

## Typed tools

To give agents your persisted operations as tools with typed arguments, see
[persisted operations as typed tools](./operations.md).

## Server instructions

`instructions` is shown to the model when it connects: say what the API is for in two or three
sentences. The tools already tell it to call `graphql_schema` first.
