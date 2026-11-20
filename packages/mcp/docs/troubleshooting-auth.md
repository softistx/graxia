# Troubleshooting auth

The answers of `auth` ([the auth guide](./guide/auth.md)) and its boot errors, each headed by the
message or code you see. Everything else is in [troubleshooting](./troubleshooting.md).

## 401 `Unauthorized: no bearer token.` (`MCP_UNAUTHORIZED`)

Header: `WWW-Authenticate: Bearer resource_metadata="…", scope="mcp:read"`.

`auth` is set and the request has no `Authorization: Bearer <token>`. A client with OAuth support
follows `resource_metadata` to the authorization server; otherwise send the token yourself. Another
scheme is not read: `Authorization: DPoP …` gets this answer too (DPoP is not supported).

## 401 `Unauthorized: the access token is invalid.` (`MCP_UNAUTHORIZED`)

Header: `WWW-Authenticate: Bearer error="invalid_token", …`, as for the next five entries.

`verifyToken` resolved `undefined`: it does not know the token (a bad signature, another issuer,
revoked). Get a new token from the authorization server.

## 401 `Unauthorized: the access token has expired.`

The `expiresAt` your verifier returned is in the past. Refresh the token.

## 401 `Unauthorized: the access token was issued for another resource.`

The `audience` your verifier returned does not contain `auth.resource` (a fragment and one trailing
slash are ignored). The client must ask for a token for the same URL as `auth.resource` (the
`resource` parameter, RFC 8707). Check the `aud` claim of the token first.

## 401 `Unauthorized: the access token carries no audience.`

`verifyToken` returned no `audience`, and the audience is checked by default. Return the token's
`aud`, or, when your verifier already refuses tokens issued for another resource, opt out with
`audience: 'verifier'` ([the auth guide](./guide/auth.md#audience)).

## 401 `Unauthorized: the verifier returned an unusable expiry (expiresAt is in seconds).`

`onError` got `createMcp: verifyToken returned expiresAt …, and expiresAt is in seconds since the
epoch`. `expiresAt` is not a finite number or is above 1e11, which is a date in milliseconds.
Return the `exp` claim as is, or `Math.floor(date.getTime() / 1000)`; leave it out when the token
has no expiry.

## 401 `Unauthorized: the verifier returned no scopes.`

`onError` got `createMcp: verifyToken must return scopes`. The info has no `scopes` array: return
`{ scopes: [...] }`, an empty list for a token with none.

## 503 `The access token could not be verified: the token verifier failed.`

With `Retry-After: 5`. `verifyToken` threw (an introspection endpoint or a key store is down); the
error went to `onError`. A throw is an outage, never a 401: resolve `undefined` for a bad token.

**Every expired token answers 503: your verifier throws on a bad token.** A JWT library that
rejects an expired, badly signed or wrong-audience token by throwing (jose's `jwtVerify`) turns
each of them into a 503 the client retries instead of refreshing its token. Catch the library's
invalid-token errors in `verifyToken` and resolve `undefined`; rethrow the rest (a JWKS fetch, an
introspection call), as in [the auth guide](./guide/auth.md#verifytoken).

## A 401 or 503 whose body is not JSON-RPC

`verifyToken` resolved a `Response` (a verifier that builds its own refusals): it is sent as is.
Read that library's documentation for its meaning.

## 403 `error="insufficient_scope", scope="mcp:read"` (`MCP_INSUFFICIENT_SCOPE`)

Message `Forbidden: the token lacks mcp:read.` Ask the authorization server for `mcp:read` (or
your `scopes.read`).

## 403 `insufficient_scope`, `scope="mcp:read mcp:write"` on `graphql_mutate` or a mutation tool

Message `Forbidden: graphql_mutate needs the scope mcp:write.` (it names the tool called, so
`rename_book needs …` for a typed tool). A read-only token called a tool that writes from a stale
tool list. Re-authorize with both scopes (the challenge's `scope`); these tools are not listed for
a token without `mcp:write`. With `mutations` off there is no 403: the call gets
`Tool graphql_mutate not found`. A mutation tool `can` hides from the caller gets no 403 either.

## `createMcp: auth.resource must be an absolute URL (got "…").`

Thrown by `createMcp` at startup. Pass the public URL of the MCP endpoint, scheme included:
`resource: 'https://api.example.com/mcp'`.

## `createMcp: auth.resource must have no query and no fragment (got "…").`

Thrown at startup. A resource identifier is the endpoint's URL alone (RFC 8707): remove the `?…`
and the `#…`.

## `createMcp: auth.authorizationServers is empty.`

Thrown at startup. List the issuer URL of the authorization server that issues the tokens:
`authorizationServers: ['https://auth.example.com']`.

## `createMcp: auth.authorizationServers must hold absolute URLs (got "…").`

Thrown at startup. Every entry is an issuer URL with its scheme (`https://auth.example.com`, not
`auth.example.com`).

## 400 `The access token is in the query string.` (`MCP_TOKEN_IN_URL`)

`?access_token=…` is refused (OAuth 2.1). Send `Authorization: Bearer <token>`.
