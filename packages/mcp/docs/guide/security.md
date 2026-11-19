# Security

## Authentication

Set `auth` and `@graxia/mcp` is an OAuth resource server: bearer tokens, scopes, protected
resource metadata ([the auth guide](./auth.md)). Every request then needs a token your
`verifyToken` accepts, and `graphql_mutate` needs the write scope.

Without `auth` nothing authenticates: mount the endpoint behind your own auth (a reverse proxy, a
check in the `Bun.serve` route before `mcp.fetch`) and treat it as you would `/graphql`. Keep
`graphql_mutate` off (`mutations` defaults to `false`) unless the caller is trusted.

```ts
routes: {
	'/mcp': async (request, server) => {
		const principal = await authenticate(request);
		if (!principal) return new Response('Unauthorized', { status: 401 });
		return mcp.fetch(request, { server, principal });
	},
},
```

## `can`

`can(request, serverContext, auth)` (`auth` is the verified token, with `auth` set) returns a function `permission => boolean` (it may be async). The
tools describe and validate against the schema as that caller sees it, so a field behind `@needs`
they lack is "Cannot query field", exactly as if it did not exist. The `@needs` is also whatever
your own resolvers or plugins enforce at run time: `can` is the view, not the lock.

## Origin, Host and DNS rebinding

A browser can be tricked into calling a local MCP server by a hostile page whose domain is
re-pointed at `127.0.0.1` (DNS rebinding): the page then talks to your server as its own origin.
Two checks stop it, both only for a request that carries an `Origin` header:

- the `Origin` must be in `allowedOrigins`, **or**
- it must be the endpoint's own origin **and** the `Host` header must name a hostname of
  `allowedHosts` (default `localhost`, `127.0.0.1`, `[::1]`). A rebound `evil.example` is its own
  origin, but it is not an allowed host: 403.

A request without `Origin` (a CLI, a server, an IDE) passes: it is not a browser. For a
non-local endpoint set the public hostname, without port:

```ts
createMcp(graxia, { name: 'library', allowedHosts: ['mcp.example.com'] });
```

## CORS

A browser client on another origin needs `allowedOrigins: ['https://app.example']`. Its `OPTIONS`
preflight is then answered 204 (`Access-Control-Allow-Origin`, `-Methods: POST`, `-Headers`
including `content-type`, `authorization`, `mcp-protocol-version` and `mcp-session-id`,
`Vary: Origin`) and every response to it carries `Access-Control-Allow-Origin` and exposes
`WWW-Authenticate`. Preflights never need a token. A preflight from
any other origin is a 403 and gets no CORS header.

## Body size and type

A POST body over the instance's `limits.bodyBytes` (1 MiB by default, read from `graxia.limits`) is
a 413. Only `application/json` is accepted (415 otherwise).

## Failures are reported, not shown

An unexpected failure (a throwing `can`, a failing transport) is sent to `onError` (default
`console.error`) with its cause; the agent only sees a generic message. The default sink skips the
SDK's protocol rejections (messages starting with `Rejected `, a client's own mistake); pass your
own `onError` to see them, or `false` to silence everything.

A document that does not parse is refused by the MCP server itself (`GRAPHQL_PARSE_FAILED`) and never
reaches `graxia.execute`, so a lenient parser set by a plugin cannot run what the visibility checks
have not seen. The checks see the document graphql's own parser reads: a plugin parser
(`setParseFn`) that rewrites a valid document into another one is trusted like any plugin, since it
already decides what runs on `/graphql` too.

CORS preflights echo the headers the browser asks for (`Access-Control-Request-Headers`), so custom
auth headers work from an allowed origin.

## What graxia still enforces

Every operation goes through `graxia.execute`: depth and alias limits, cost, trusted documents,
masking of resolver errors, field rate limits, and your `context`. MCP does not bypass any of them.
