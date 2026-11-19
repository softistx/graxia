# Troubleshooting

Each entry is headed by the message or code you see.

## 403 `Origin https://… is not allowed.`

A browser client sent an `Origin` that is not in `allowedOrigins` and is not the endpoint's own.

```ts
createMcp(graxia, { name: 'library', allowedOrigins: ['https://app.example'] });
```

A CLI or server client sends no `Origin` and is not affected.

## 403 `Host … is not allowed.`

The request is same-origin but its `Host` header names a hostname outside `allowedHosts` (default
`localhost`, `127.0.0.1`, `[::1]`): the DNS-rebinding guard. Set the endpoint's public hostname,
without port. Behind a proxy, list the hostname the browser uses.

```ts
createMcp(graxia, { name: 'library', allowedHosts: ['mcp.example.com'] });
```

## 405 `GET is not supported: this endpoint is stateless.`

Also `DELETE is not supported: this endpoint is stateless.` (and any other method but `POST`). The
endpoint has no server-to-client stream and no sessions. Clients send `POST`; a client that probes
with `GET` or `DELETE` and goes on after the 405 is working as intended.

## 413 `The request body is larger than … bytes.`

The body is over `limits.bodyBytes` of the graxia instance, which the MCP endpoint reads from
`graxia.limits`. Send a smaller request or raise it on `createGraxia`; both endpoints follow.

## 415 `The request body must be application/json.`

Send `Content-Type: application/json`.

## 500 `The MCP server failed to handle the request.`

The transport failed (a broken body stream, a bug). The cause is not sent; it went to `onError`
(default `console.error`). Pass your own to log it:

```ts
createMcp(graxia, { name: 'library', onError: (error) => logger.error(error) });
```

## `createMcp: no serverContext for this request; the MCP handler ran outside fetch.`

The handler was called without going through `mcp.fetch`. Always mount `mcp.fetch`.

## `Cannot query field "x" on type "Y"` for a field that exists

Reported with `extensions.code` `GRAPHQL_VALIDATION_FAILED`.

The field is behind `@needs` and `can` says the caller lacks the permission, or `can` is not what
you meant: the view is built from `can`'s answer. Check it with `graphql_schema` as that caller.

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

## 403 `insufficient_scope`, `scope="mcp:read mcp:write"` on `graphql_mutate`

Message `Forbidden: graphql_mutate needs the scope mcp:write.` A read-only token called
`graphql_mutate` from a stale tool list. Re-authorize with both scopes (the challenge's `scope`);
the tool is not listed for a token without `mcp:write`. With `mutations` off there is no 403: the
call gets `Tool graphql_mutate not found`.

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

## `graphql_mutate` is missing from the list with `mutations: true`

With `auth`, it is listed only for a token with the write scope (`mcp:write` by default).

## `GraphQL introspection has been disabled…` / `Use graphql_schema to read the schema.`

`__schema` and `__type` are refused over MCP: they would show fields `@needs` hides. Call
`graphql_schema` (no input, `types` or `search`). `__typename` is allowed.

## `# Unknown type X. Fix: call graphql_schema with no input to list the type names you can use.`

`graphql_schema` was asked for a type the caller cannot see or that does not exist. The `Mutation`
root is also unknown unless `mutations: true`. Call it with no input for the list.

## `A mutation cannot run in graphql_query.`

Use `graphql_mutate` (listed only with `mutations: true`). The reverse, `A query cannot run in
graphql_mutate.`, means use `graphql_query`. Code `MCP_OPERATION_NOT_ALLOWED`. In a document with
several operations, `operationName` picks the one checked.

## `Subscriptions are not available over MCP.`

Code `SUBSCRIPTION_NOT_SUPPORTED`. Send a query, or poll the same query again.

## `@defer is not available over MCP.` (or `@stream`)

Code `INCREMENTAL_NOT_SUPPORTED`. Remove the directive: the tool returns one complete JSON result.

## A parse failure (`Syntax Error: …`, `Document contains more than N tokens.`)

Code `GRAPHQL_PARSE_FAILED`, raised by the MCP server before `graxia.execute`: correct the syntax at the position the error gives, or
raise `limits.tokens` on `createGraxia` for a very large document.

## `Tool graphql_mutate not found`

It is listed only with `mutations: true` (and, with `auth`, for a token with the write scope).
`Tool graphql_query not found`: `genericTools` is `false`; call a typed tool.

## `Tool book_by_id not found` for an operation of the manifest

The tool is not offered to this caller: its operation uses a field `can` hides from them, it is a
mutation without `mutations: true`, `include` left it out, or it is a subscription. The answer is
the same as for a tool that does not exist. Call `graphql_schema` for the typed tools you have.

## `createMcp: operations has N problems:`

One error lists every problem of `operations.documents`, one per line, each ending with its fix:

- `document "a1" holds an anonymous operation: a tool needs a name.` Name it and regenerate.
- `BookById (document "a1") has no description: …` Write `"""…"""` above the operation, or set
  `operations.descriptions.BookById`. A toolchain that drops descriptions needs the option.
- `BookById (document "a1") and Book_by_id (document "a2") both give the tool name book_by_id.`
  Rename one, or leave one out with `include`.
- `GraphqlQuery (document "a1") gives the tool name graphql_query, and graphql_* names are the
  generic tools'.` Rename the operation, or leave it out.
- `document "a1" does not parse: Syntax Error: …` Regenerate the manifest.
- `BookById (document "a1") is not valid against the schema: Cannot query field …` The manifest is
  older than the schema (or belongs to another server): regenerate it. Introspection (`__schema`)
  is reported here too.
- `BookById (document "a1") uses @defer, which is not available over MCP: …` (or `@stream`).
- `document "a1" is not a GraphQL source string.` Map every id to the text of its document.
- `operations.documents is not a manifest.` Pass a `Map`, an object of id to source, or an Apollo
  persisted query manifest.

Operations `include` leaves out, subscriptions, and mutations without `mutations: true` are not
checked.

## `createMcp: genericTools is false and there is no operations: …`

Also `genericTools is false and operations gives no tool: …`. Without the generic tools an agent
needs at least one typed tool: pass `operations` (mutations need `mutations: true`), or remove
`genericTools: false`.

## A typed tool answers `Variable "$id" …`

The arguments are the operation's variables, checked by graxia: read `extensions.fix`, and the
tool's `inputSchema` in `tools/list`.

## 403 `insufficient_scope`, `rename_book needs the scope mcp:write`

A mutation typed tool was called with a read-only token: the same step-up as `graphql_mutate`.

## Every query is refused with a trusted-documents error

`trustedDocuments` is `strict` (the default under `NODE_ENV=production`): graxia refuses any
document outside the manifest (`PERSISTED_QUERY_ONLY`), so an agent cannot send arbitrary queries.
Give the agent [typed tools](./guide/operations.md) (`operations`), which run in strict mode.

## `graxia.execute: the request ended with an HTTP … response instead of a result; see error.response.`

Code `MCP_EXECUTION_REFUSED`, with the fix `Retry later; if it persists, the server is shutting
down or a plugin refused the request.` A plugin answered with its own response whose body has no
`errors`, or the server is shutting down. A plugin response with `errors` reaches the agent as
they are (its code and fix, e.g. `UNAUTHENTICATED`), so shape your plugin's refusal as
`{ errors: [{ message, extensions: { code, fix } }] }`.

## `The server failed to run the operation. Fix: retry later.`

An unexpected failure inside the tool (a throwing `can`, a bug); its cause is not sent. It went to
`onError` and, for the operation itself, to graxia's `onUnexpected`.
