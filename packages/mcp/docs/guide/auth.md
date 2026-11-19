# OAuth resource server

With `auth`, `@graxia/mcp` is an OAuth 2.1 **resource server** (MCP authorization spec, RFC 9728,
RFC 8707): it accepts bearer access tokens, it never issues them. Your authorization server does.

## The flow

1. The client calls `/mcp` with no token: **401** and
   `WWW-Authenticate: Bearer resource_metadata="https://api.example.com/.well-known/oauth-protected-resource/mcp", scope="mcp:read"`.
2. It reads that metadata (`mcp.metadata`) and signs the user in at the authorization server it
   names, asking for a token for this resource.
3. It retries with `Authorization: Bearer <token>`.

## Mount it

```ts
import { createGraxia } from '@graxia/core';
import { createMcp } from '@graxia/mcp';

const graxia = createGraxia({ schema });
const mcp = createMcp(graxia, {
	name: 'library',
	mutations: true,
	auth: {
		resource: 'https://api.example.com/mcp',
		authorizationServers: ['https://auth.example.com'],
		verifyToken: async (token) => {
			// your verifier (signature, issuer): it resolves undefined for a bad token, see below
			const claims = await verifyJwt(token);
			if (!claims) return undefined; // a 401
			return {
				subject: claims.sub,
				clientId: claims.client_id,
				scopes: claims.scope.split(' '),
				expiresAt: claims.exp, // seconds
				audience: claims.aud, // compared with `resource`
			};
		},
	},
});

Bun.serve({
	routes: {
		[mcp.metadataPath]: mcp.metadata, // /.well-known/oauth-protected-resource/mcp
		'/mcp': (request, server) => mcp.fetch(request, { server }),
	},
	fetch: graxia.fetch,
});
```

`metadataPath` is the RFC 9728 well-known path with the path of `resource` inserted. It is typed
`string` when `auth` is passed to `createMcp`, and is `undefined` without it. `metadata` answers GET
with the JSON document (CORS `*`, `Cache-Control: max-age=3600`), any other method with a 405, and
a 404 without `auth`. `scopes_supported` lists the write scope only with `mutations: true`.

## Options

| option                 | meaning                                                                          |
| ---------------------- | -------------------------------------------------------------------------------- |
| `resource`             | canonical URL of the endpoint, what tokens are issued for; no query, no fragment |
| `authorizationServers` | issuer URLs (absolute, at least one), published in the metadata                  |
| `verifyToken`          | `(token, request) => McpAuthInfo \| Response \| undefined`, see below            |
| `audience`             | `'resource'` (default) or `'verifier'`: who checks the audience, see below       |
| `scopes`               | `{ read, write }`, default `mcp:read` and `mcp:write`                            |
| `resourceName`         | `resource_name` of the metadata                                                  |
| `documentation`        | `resource_documentation` of the metadata                                         |

A wrong `resource` or `authorizationServers` throws at `createMcp`
([troubleshooting](../troubleshooting.md)).

## `verifyToken`

It receives the token of `Authorization: Bearer <token>` and the request. It must read the
request's headers only, **never its body**: the body is read after the gate.

It resolves the token's `McpAuthInfo`, `undefined` for a token it does not accept, or a `Response`
when it builds its own refusals: that response is sent as is (plus the CORS headers of an allowed
origin). A **throw is an outage, not a bad token**: the client gets a 503 with `Retry-After: 5`
and the error goes to `onError`.

**Do not let a bad token throw.** Many JWT libraries reject an expired, badly signed or
wrong-audience token by throwing (jose's `jwtVerify` does). Passed through, every expired token
becomes a 503 the client retries for ever instead of a 401 it refreshes on, and each one reaches
`onError`. Catch the library's invalid-token errors and resolve `undefined`; let only real outages
(a JWKS fetch, an introspection call) throw:

```ts
verifyToken: async (token) => {
	let claims;
	try {
		claims = await verifyJwt(token); // throws InvalidTokenError, or a network error
	} catch (error) {
		if (error instanceof InvalidTokenError) return undefined; // a bad token: 401
		throw error; // an outage: 503, retried
	}
	return { subject: claims.sub, scopes: claims.scope.split(' '), audience: claims.aud };
},
```

Tell the two apart by the error's class, as above. With jose (`import { errors } from 'jose'`),
`errors.JWTExpired`, `JWTClaimValidationFailed`, `JWSSignatureVerificationFailed`, `JWTInvalid`,
`JWSInvalid`, `JWKSNoMatchingKey` and `JOSEAlgNotAllowed` are bad tokens; `JWKSTimeout` and a failed
fetch are outages. A bare `catch { return undefined }` would
hide an outage as a 401 and make clients sign in again for nothing.

`McpAuthInfo` is `{ subject?, clientId?, scopes, expiresAt?, audience?, extra? }`:

- `scopes` is required, an array (empty for none).
- `expiresAt` is optional and **in seconds** since the epoch (the `exp` claim). A value in
  milliseconds, `NaN` or `Infinity` is refused.
- `audience` is the `aud` claim, a string or a list.

Only the `Bearer` scheme is read. **DPoP is not supported**: `Authorization: DPoP <token>` gets the
401 of a missing token.

## What is checked, in order

After the origin, host and method checks, and before the body is read:

| case                                          | answer                                                      |
| --------------------------------------------- | ----------------------------------------------------------- |
| `access_token` in the query string            | 400, `MCP_TOKEN_IN_URL` (OAuth 2.1 forbids it)              |
| no `Authorization: Bearer`                    | 401, `MCP_UNAUTHORIZED`, challenge with `scope="mcp:read"`  |
| `verifyToken` throws                          | 503, `Retry-After: 5`, `onError`                            |
| it resolves a `Response`                      | that response                                               |
| it resolves `undefined`                       | 401, `error="invalid_token"`                                |
| no `scopes` array, or an unusable `expiresAt` | 401, `invalid_token`, and `onError` (a verifier bug)        |
| `expiresAt` in the past                       | 401, `invalid_token`                                        |
| no `audience`, or one without `resource`      | 401, `invalid_token` (unless `audience: 'verifier'`)        |
| token without the read scope                  | 403, `error="insufficient_scope"`, `MCP_INSUFFICIENT_SCOPE` |

Every refusal of graxia's is a JSON-RPC error with a `fix`. A preflight from an allowed origin
needs no token, and `WWW-Authenticate` is exposed to allowed origins.

## Audience

A token issued for another service must never be accepted here, so the check is on by default:
`verifyToken` returns `audience`, and it must contain `resource` (a fragment and one trailing slash
are ignored). A token whose info has **no** `audience` is refused.

When your verifier already refuses tokens issued for another resource (an introspection endpoint
bound to this resource, a library that takes the resource as an option), say so:

```ts
auth: { resource, authorizationServers, verifyToken, audience: 'verifier' },
```

Nothing is compared then, and a returned `audience` is only handed to `can` and `mcpAuth()`.

## Scopes and step-up

The read scope opens every tool but `graphql_mutate`, which is listed only when `mutations: true`
**and** the token has the write scope; a read-only token also gets an overview without the
`Mutation` root. A read-only token that calls it anyway (a stale tool list), alone or inside a
JSON-RPC batch, gets a **403** `error="insufficient_scope", scope="mcp:read mcp:write"`: the
step-up challenge that tells the client to re-authorize with both scopes. It is an HTTP answer,
not a tool error (the SDK's tool `scopeChallenge` cannot guard a tool that is not registered for
that caller).

With `mutations` off there is no step-up, since no scope opens the tool: the call gets the
protocol's `Tool graphql_mutate not found`.

## The principal

`can(request, serverContext, auth)` receives the verified `McpAuthInfo` as its third argument, so
the schema a caller sees can follow its scopes or roles.

`mcpAuth()` returns the same info anywhere during a tool call, for graxia's `context` builder and
resolvers, with no second verification. Outside a tool call, and during a call to an instance
without `auth`, it is `undefined`.

```ts
import { mcpAuth } from '@graxia/mcp';

const graxia = createGraxia({
	schema,
	context: () => ({ userId: mcpAuth()?.subject }),
});
```

The `Authorization` header is still forwarded to `graxia.execute`, so a context builder that
verifies tokens itself keeps working.

## With `@softistx/janus-oauth`

`bearerCaller` resolves a request to its caller (an API key or an access token for the resource)
or to the `Response` to answer instead, so it is the whole verifier. No dependency is added to
`@graxia/mcp`.

```ts
import {
	type BearerCaller,
	bearerCaller,
	protectedResource,
} from '@softistx/janus-oauth';
import { createMcp, mcpAuth } from '@graxia/mcp';

const resource = 'https://api.example.com/mcp';
const issuer = 'https://auth.example.com';
// `accounts` is your janus() instance, `oauth` your authorization server.
const callerOf = bearerCaller({
	accounts,
	oauth,
	resource: protectedResource({
		resource,
		issuer,
		scopes: ['mcp:read', 'mcp:write'],
	}),
});

const mcp = createMcp(graxia, {
	name: 'library',
	mutations: true,
	auth: {
		resource,
		authorizationServers: [issuer],
		audience: 'verifier', // bearerCaller refuses a token for another resource
		verifyToken: async (_token, request) => {
			const caller = await callerOf(request);
			return caller instanceof Response
				? caller
				: { subject: caller.userId, scopes: caller.scopes, extra: { caller } };
		},
	},
});

// In graxia's context builder: what the key or the grant is pinned to.
const context = () => {
	const caller = mcpAuth()?.extra?.['caller'] as BearerCaller | undefined;
	return {
		userId: caller?.userId,
		bound: caller?.bound ?? null,
		authorizationDetails: caller?.authorizationDetails ?? [],
	};
};
```

- `protectedResource({ resource, scopes })` must use the **same URL** as `auth.resource`, and list
  the read and the write scope (`mcp:read`, `mcp:write`, or your `auth.scopes`): an unscoped API
  key holds exactly those.
- `bearerCaller`'s refusals (401 with its challenge, 503 on a store outage) are returned as they
  are. It checks the expiry and the audience itself, hence no `expiresAt` and `audience: 'verifier'`.
- `verifyToken` must not read the request body: hand the request to `callerOf` untouched, it
  authenticates from the headers.
- A DPoP-bound token is not accepted by `@graxia/mcp`; leave `dpop` off on `protectedResource`.
