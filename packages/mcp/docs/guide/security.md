# Security

## No authentication yet

`@graxia/mcp` does not authenticate. Until OAuth lands, mount the endpoint behind your own auth
(a reverse proxy, a check in the `Bun.serve` route before `mcp.fetch`) and treat the endpoint as
you would `/graphql`. Keep `graphql_mutate` off (`mutations` defaults to `false`) unless the caller
is trusted.

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

`can(request, serverContext)` returns a function `permission => boolean` (it may be async). The
tools describe and validate against the schema as that caller sees it, so a field behind `@needs`
they lack is "Cannot query field", exactly as if it did not exist. The `@needs` is also whatever
your own resolvers or plugins enforce at run time: `can` is the view, not the lock.

## Origin

A browser cannot be trusted to call a local MCP server (DNS rebinding). A request that carries an
`Origin` header is refused with a 403 unless it is the endpoint's own origin or one of
`allowedOrigins`. A request without `Origin` (a CLI, a server, an IDE) passes. Behind a proxy that
changes the host, the endpoint's origin is the one in the request URL: list the public origin in
`allowedOrigins`.

## Body size and type

A POST body over `maxBodyBytes` (default 1 MiB, graxia's own default) is a 413; keep it equal to
`limits.bodyBytes`. Only `application/json` is accepted (415 otherwise).

## What graxia still enforces

Every operation goes through `graxia.execute`: depth and alias limits, cost, trusted documents,
masking of resolver errors, field rate limits, and your `context`. MCP does not bypass any of them.
