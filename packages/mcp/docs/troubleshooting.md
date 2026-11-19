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

The field is behind `@needs` and `can` says the caller lacks the permission, or `can` is not what
you meant: the view is built from `can`'s answer. Check it with `graphql_schema` as that caller.

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

Code `GRAPHQL_PARSE_FAILED`, from graxia: correct the syntax at the position the error gives, or
raise `limits.tokens` on `createGraxia` for a very large document.

## `graphql_mutate` is not found

It is listed only with `mutations: true`.

## Every query is refused with a trusted-documents error

`trustedDocuments` is `strict` (the default under `NODE_ENV=production`): graxia refuses any
document outside the manifest (`PERSISTED_QUERY_ONLY`), so an agent cannot send arbitrary queries.
Persisted operations as typed tools are on the [roadmap](./roadmap.md).

## `graxia.execute: the request ended with an HTTP … response instead of a result; see error.response.`

Code `MCP_EXECUTION_REFUSED`, with the fix `Retry later; if it persists, the server is shutting
down or a plugin refused the request.` A plugin answered with its own response whose body has no
`errors`, or the server is shutting down. A plugin response with `errors` reaches the agent as
they are (its code and fix, e.g. `UNAUTHENTICATED`), so shape your plugin's refusal as
`{ errors: [{ message, extensions: { code, fix } }] }`.

## `The server failed to run the operation. Fix: retry later.`

An unexpected failure inside the tool (a throwing `can`, a bug); its cause is not sent. It went to
`onError` and, for the operation itself, to graxia's `onUnexpected`.
