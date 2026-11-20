# Tools

Every tool sees the schema as the caller may see it: with `can`, a field behind `@needs` the caller
lacks does not exist for them (it is neither described nor accepted).

With `operations`, each persisted operation is one more tool, with typed arguments: see
[persisted operations as typed tools](./operations.md). `genericTools: false` removes
`graphql_query` and `graphql_mutate` and keeps `graphql_schema` and the typed tools.

## `graphql_schema`

Input `{ search?: string, types?: string[] }`.

- **No input**: the operations the caller can use (root fields with their arguments and the first
  line of their description, `Query`, and `Mutation` only when `mutations` is on) and the list of
  type names (the `Mutation` root is not offered, nor found by `search`, unless `mutations` is on).
  With `operations` it ends with the typed tools this caller has, and says to prefer them (with
  `genericTools: false`, or in strict trusted-documents mode, that they are the only way to run
  operations).
- **`types`**: the SDL of those types, with descriptions, `@deprecated` and the applied `@needs`,
  `@constraint` and `@errors`, plus the definition of each of those directives used. A name that
  does not exist is listed as unknown, with a fix.
- **`search`**: every word (case-insensitive) must appear in the type's name or description, or in
  a field or enum value name or description. The answer is the SDL of the matching types, at most
  50 (`types` takes at most 50 names too); when more match it says so and tells the agent to narrow the search.

## `graphql_query`

Input `{ query: string, variables?: object, operationName?: string }`. The document is parsed and
validated against the caller's view, then run through `graxia.execute`, so operation limits, cost,
masking and field rate limits apply as they do on HTTP ([trusted documents](#trusted-documents) below).

Introspection (`__schema`, `__type`) is refused: it would show fields `@needs` hides. Use
`graphql_schema`. `__typename` stays allowed. Only the validation rules that decide what the caller
may see run on the view (unknown fields, types and arguments, impossible fragment spreads);
limits, cost and the rest of validation are graxia's, when the operation runs, with graxia's own
codes. A document that does not parse is refused here (the token limit of graxia applies) and never handed to graxia.

### Refusals

| input                                         | `extensions.code`                        | message                                     | fix                                                                                         |
| --------------------------------------------- | ---------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------- |
| a document that does not parse                | `GRAPHQL_PARSE_FAILED`                   | the parser's message                        | correct the syntax                                                                          |
| an unknown or hidden field, type or argument  | `GRAPHQL_VALIDATION_FAILED`              | `Cannot query field "x" on type "Y".`       | call `graphql_schema`, correct the operation                                                |
| `__schema` or `__type`                        | `GRAPHQL_VALIDATION_FAILED`              | graphql's introspection message             | `Use graphql_schema to read the schema.`                                                    |
| a mutation in `graphql_query`                 | `MCP_OPERATION_NOT_ALLOWED`              | `A mutation cannot run in graphql_query.`   | use `graphql_mutate`                                                                        |
| a query in `graphql_mutate`                   | `MCP_OPERATION_NOT_ALLOWED`              | `A query cannot run in graphql_mutate.`     | use `graphql_query`                                                                         |
| a subscription                                | `SUBSCRIPTION_NOT_SUPPORTED`             | `Subscriptions are not available over MCP.` | send a query                                                                                |
| `@defer` or `@stream`                         | `INCREMENTAL_NOT_SUPPORTED`              | `@defer is not available over MCP.`         | remove the directive                                                                        |
| a limit, cost or rate refusal, a bad variable | graxia's own                             | graxia's message                            | graxia's fix                                                                                |
| a plugin answered with its own response       | the plugin's, when its body has `errors` | the plugin's                                | the plugin's                                                                                |
| a plugin response with no `errors`, shutdown  | `MCP_EXECUTION_REFUSED`                  | the `graxia.execute` message                | `Retry later; if it persists, the server is shutting down or a plugin refused the request.` |

`operationName` picks the operation: only the selected one is checked against the tool's kind, so a
document holding a query and a mutation runs its query in `graphql_query`.

## `graphql_mutate`

Listed only with `mutations: true` (and, with `auth`, only for a token with the write scope,
`mcp:write` by default; a read-only token calling it gets a 403 step-up, see [auth](./auth.md); with `mutations` off the call is `Tool graphql_mutate not found`); same input. A query is refused with a fix pointing to
`graphql_query`. Without the option the tool does not exist: calling it is a JSON-RPC error.

## Results

```json
{ "data": { "books": [{ "title": "Dune" }] } }
```

- `structuredContent` is the GraphQL result (`{ data?, errors? }`); `content[0].text` is the same JSON.
- `isError` is `true` when there is no `data` (the operation did not run, or failed before any
  field). A result with `data` and field `errors` is not an error call: the agent reads `errors`.
- Every error has `extensions.code` and `extensions.fix`. A masked failure keeps graxia's
  `INTERNAL_SERVER_ERROR` code and its fix ("Retry later; quote the correlationId…"); the message
  and cause never leak.

## Trusted documents

With `trustedDocuments` in `strict` mode (the default in production) graxia runs no document a
client writes, and neither does the MCP server: `graphql_query` and `graphql_mutate` are **not
listed**, and a call answers `Only persisted documents are allowed.` with the code
`PERSISTED_QUERY_ONLY` and a fix naming the typed tools the caller has. `graphql_schema` stays.
The [typed tools](./operations.md) of `operations` run: they are the documents you persisted.
Without `operations` a strict server boots with `graphql_schema` alone, so nothing can be run:
pass `operations`. In `mixed` mode the generic tools are unchanged.

## Cost of `can`

The caller view is built lazily, by the tool that needs it: `initialize`, `ping`, notifications
and `tools/list` never build it. Without `can` it is computed once, on the first tool call. With
`can`, it is computed on every tool call (the schema is printed and rebuilt for that caller's
permissions). It is cheap for a small schema; for a large one, keep `can` fast and expect a few
milliseconds per request. With `operations` the view decides which typed tools exist, so
`tools/list` and every `tools/call` build it (still once for all callers without `can`);
`initialize`, `ping` and notifications still do not.
