# Troubleshooting

Each entry is headed by the message or code you see. The 401, 403 and 503 answers of `auth` and its
boot errors are in [troubleshooting auth](./troubleshooting-auth.md).

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

## `graphql_mutate` is missing from the list with `mutations: true`

With `auth`, it is listed only for a token with the write scope (`mcp:write` by default). When
graxia runs trusted documents in `strict` mode it is never listed, like `graphql_query`.

## `GraphQL introspection has been disabled…` / `Use graphql_schema to read the schema.`

`__schema` and `__type` are refused over MCP: they would show fields `@needs` hides. Call
`graphql_schema` (no input, `types` or `search`). `__typename` is allowed.

## `No type matches "x".` (or `Empty search.`)

`graphql_schema` with `search` found no type or field of that name in the caller's view (a hidden
type is not found either); `Empty search.` means `search` was blank. Call `graphql_schema` with
no input for the type names, then search a word of one of them.

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

## `createMcp: operations has 1 problem:` (or `N problems:`)

One error lists every problem of `operations`, one per line, each ending with its fix:

- `document "a1" holds an anonymous operation: a tool needs a name.` Name it and regenerate.
- `BookById (document "a1") has no description: …` Write `"""…"""` above the operation, or set
  `operations.descriptions.BookById`. A toolchain that drops descriptions needs the option.
- `operations.descriptions.bookById matches no operation of operations.documents (there is
  BookById: names are case-sensitive).` Rename or remove the key.
- `BookById (document "a1") and Book_by_id (document "a2") both give the tool name book_by_id.`
  Rename one, or leave one out with `include`.
- `GraphqlQuery (document "a1") gives the tool name graphql_query, and graphql_* names are the
  generic tools'.` Rename the operation, or leave it out.
- `… gives a tool name of 140 characters, and MCP allows 128.` Rename the operation.
- `document "a1" does not parse: Syntax Error: …` Regenerate the manifest.
- `BookById (document "a1") is not valid against the schema: Cannot query field …` The manifest is
  older than the schema (or belongs to another server): regenerate it.
- `Types (document "a1") selects __schema or __type: introspection is not offered over MCP, …`
  Leave the operation out with `include`: an agent reads the schema with `graphql_schema`.
- `BookById (document "a1") uses @defer, which is not available over MCP: …` (or `@stream`).
- `document "a1" is not a GraphQL source string.` Map every id to the text of its document.
- `operations.documents is not a manifest.` Pass a `Map`, an object of id to source, or an Apollo
  persisted query manifest.
- `genericTools is false and operations gives no tool: …` Without the generic tools an agent needs
  at least one typed tool: check `documents` and `include` (mutations need `mutations: true`).

An operation `include` leaves out, a subscription, and a mutation without `mutations: true` is not
validated and needs no description; every document must still parse and name its operations.

## ``createMcp: graxia runs trusted documents in strict mode and `operations` gives no tool: …``

Reported once through `onError` at boot (not thrown: the same code boots in development). graxia's
`trustedDocuments` is `strict` (the default under `NODE_ENV=production`), so `graphql_query` and
`graphql_mutate` are not listed, and with no `operations` there is no typed tool: agents read the
schema and run nothing. Fix: pass the persisted documents.

```ts
createMcp(graxia, { name: 'library', operations: { documents: manifest } });
```

## `createMcp: allowedHosts entry "…" can never match` / `allowedOrigins entry "…" can never match`

Thrown at startup. `allowedHosts` takes hostnames only (`mcp.example.com`, `[::1]`), without
scheme, port or path; `allowedOrigins` takes exactly `scheme://host[:port]`, with no path and no
trailing slash. The message gives the corrected value.

```ts
createMcp(graxia, {
	name: 'library',
	allowedHosts: ['mcp.example.com'], // not 'mcp.example.com:3000'
	allowedOrigins: ['https://app.example'], // not 'https://app.example/'
});
```

## `createMcp: genericTools is false and there is no operations: …`

Pass `operations: { documents: manifest }`, or remove `genericTools: false`.

## `book_by_id does not take the argument extra.` (`MCP_UNKNOWN_ARGUMENT`)

A typed tool was called with an argument that is not a variable of its operation. The fix names
the arguments it accepts; they are the `properties` of its `inputSchema` in `tools/list`.

## A typed tool answers `Variable "$id" …` (`BAD_USER_INPUT`)

An argument is missing or has the wrong type: graxia checks the arguments as the operation's
variables. The fix is `Correct the arguments: see the tool's input schema.`

## `Forbidden: rename_book needs the scope mcp:write.` (`MCP_INSUFFICIENT_SCOPE`)

A 403 `insufficient_scope`: a mutation typed tool was called with a read-only token, the same
step-up as `graphql_mutate` ([auth troubleshooting](./troubleshooting-auth.md)).

## `Only persisted documents are allowed.` (`PERSISTED_QUERY_ONLY`) from `graphql_query`

graxia's `trustedDocuments` is `strict` (the default under `NODE_ENV=production`), so the server
runs no document an agent writes: `graphql_query` and `graphql_mutate` are not listed and a call
answers this refusal, whose fix names the typed tools the caller has. Give the agent
[typed tools](./guide/operations.md) (`operations`); without them only `graphql_schema` is there.

## `graxia.execute: the request ended with an HTTP … response instead of a result; see error.response.`

Code `MCP_EXECUTION_REFUSED`, with the fix `Retry later; if it persists, the server is shutting
down or a plugin refused the request.` A plugin answered with its own response whose body has no
`errors`, or the server is shutting down. A plugin response with `errors` reaches the agent as
they are (its code and fix, e.g. `UNAUTHENTICATED`), so shape your plugin's refusal as
`{ errors: [{ message, extensions: { code, fix } }] }`.

## `The server failed to run the operation. Fix: retry later.`

An unexpected failure inside the tool (a throwing `can`, a bug); its cause is not sent. It went to
`onError` and, for the operation itself, to graxia's `onUnexpected`. When `can` throws,
`tools/list` also answers without the typed tools, and a call to one gets this answer: the cause
is in `onError`.
