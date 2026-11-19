# OAuth resource server

With `auth`, `@graxia/mcp` is an OAuth 2.1 **resource server** (MCP authorization spec, RFC 9728,
RFC 8707): it accepts bearer access tokens, it never issues them. Your authorization server does.

## The flow

1. The client calls `/mcp` with no token: **401** and
   `WWW-Authenticate: Bearer resource_metadata="https://api.example.com/.well-known/oauth-protected-resource/mcp", scope="mcp:read"`.
2. It reads that metadata (`mcp.metadata`): the `authorization_servers` and `scopes_supported`.
3. It signs the user in at the authorization server and gets a token for the resource
   (`https://api.example.com/mcp`) with the scope `mcp:read`.
4. It retries with `Authorization: Bearer <token>`.

## Mount it

```ts
const mcp = createMcp(graxia, {
	name: 'library',
	mutations: true,
	auth: {
		resource: 'https://api.example.com/mcp',
		authorizationServers: ['https://auth.example.com'],
		verifyToken: async (token, request) => {
			const claims = await verifyJwt(token); // your verifier
			return (
				claims && {
					subject: claims.sub,
					clientId: claims.client_id,
					scopes: claims.scope.split(' '),
					expiresAt: claims.exp,
					audience: claims.aud,
				}
			);
		},
	},
});

Bun.serve({
	routes: {
		[mcp.metadataPath as string]: mcp.metadata, // /.well-known/oauth-protected-resource/mcp
		'/mcp': (request, server) => mcp.fetch(request, { server }),
	},
	fetch: graxia.fetch,
});
```

`metadataPath` is the RFC 9728 well-known path with the path of `resource` inserted (`undefined`
without `auth`). `metadata` answers GET with `{ resource, authorization_servers, scopes_supported,
bearer_methods_supported: ["header"], resource_name?, resource_documentation? }`, CORS `*` and
`Cache-Control: max-age=3600`; any other method is 405. Without `auth` it answers 404.

## Options

| option                 | meaning                                                                          |
| ---------------------- | -------------------------------------------------------------------------------- |
| `resource`             | canonical URL of the endpoint: what tokens are issued for (an absolute URL)      |
| `authorizationServers` | issuer URLs, published in the metadata (at least one)                            |
| `verifyToken`          | `(token, request) => McpAuthInfo \| undefined`; `undefined` or a throw = invalid |
| `scopes`               | `{ read, write }`, default `mcp:read` and `mcp:write`                            |
| `resourceName`         | `resource_name` of the metadata                                                  |
| `documentation`        | `resource_documentation` of the metadata                                         |

`McpAuthInfo` is `{ subject?, clientId?, scopes, expiresAt? (seconds), audience?, extra? }`.

## What is checked, in order

After the origin, host and method checks, and before the body is read:

| case                                         | answer                                                        |
| -------------------------------------------- | ------------------------------------------------------------- |
| `access_token` in the query string           | 400, `MCP_TOKEN_IN_URL` (OAuth 2.1 forbids it)                |
| no `Authorization: Bearer`                   | 401, `MCP_UNAUTHORIZED`, challenge with `scope="mcp:read"`    |
| `verifyToken` resolves `undefined` or throws | 401, `error="invalid_token"` (a throw also goes to `onError`) |
| `expiresAt` in the past                      | 401, `invalid_token`                                          |
| `audience` returned and without `resource`   | 401, `invalid_token`                                          |
| token without the read scope                 | 403, `error="insufficient_scope"`, `MCP_INSUFFICIENT_SCOPE`   |

Every refusal is a JSON-RPC error with a `fix`. A preflight from an allowed origin needs no token,
and `WWW-Authenticate` is exposed to allowed origins (`Access-Control-Expose-Headers`).

**Audience.** When `verifyToken` returns `audience` (the `aud` claim), graxia compares it with
`resource` (ignoring a fragment and one trailing slash). When it returns none, **your verifier must
check the audience itself**: a token issued for another service must never be accepted here.

## Scopes and step-up

The read scope opens every tool but `graphql_mutate`. `graphql_mutate` is listed only when
`mutations: true` **and** the token has the write scope; a read-only token also gets an overview
without the `Mutation` root. A read-only token that calls it anyway (a stale tool list) gets a **403**
`error="insufficient_scope", scope="mcp:read mcp:write"`, the step-up challenge that tells the
client to re-authorize with both scopes. (It is an HTTP answer, not a tool error: the SDK's tool
`scopeChallenge` cannot guard a tool that is not registered for that caller.)

## The principal

`can(request, serverContext, auth)` receives the verified `McpAuthInfo` as its third argument, so
the schema a caller sees can follow its scopes or roles.

`mcpAuth()` returns the same info anywhere during a tool call, for graxia's `context` builder and
resolvers, with no second verification. Outside a tool call (and without `auth`) it is `undefined`.

```ts
import { mcpAuth } from '@graxia/mcp';

const graxia = createGraxia({
	schema,
	context: ({ request }) => ({ userId: mcpAuth()?.subject }),
});
```

The `Authorization` header is still forwarded to `graxia.execute`, so a context builder that
verifies tokens itself keeps working.

## A verifier

`verifyToken` is yours: a JWT check against the issuer's keys, or an RFC 7662 introspection call.
With the in-house authorization server (`@softistx/janus-oauth`), `bearerCaller` already resolves
a request to a caller (an API key or an access token for this resource), so wrap it:

```ts
import { bearerCaller } from '@softistx/janus-oauth';

const callerOf = bearerCaller({ accounts, oauth, resource }); // resource: protectedResource(...)

verifyToken: async (_token, request) => {
	const caller = await callerOf(request);
	return caller instanceof Response
		? undefined
		: { subject: caller.userId, clientId: caller.id, scopes: caller.scopes };
},
```

`bearerCaller` checks the audience and the expiry itself; no dependency is added to
`@graxia/mcp`.
