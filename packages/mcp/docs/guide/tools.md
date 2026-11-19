# Tools

Every tool sees the schema as the caller may see it: with `can`, a field behind `@needs` the caller
lacks does not exist for them (it is neither described nor accepted).

## `graphql_schema`

Input `{ search?: string, types?: string[] }`.

- **No input**: the operations the caller can use (root fields with their arguments and the first
  line of their description, `Query`, and `Mutation` only when `mutations` is on) and the list of
  type names.
- **`types`**: the SDL of those types, with descriptions, `@deprecated` and the applied `@needs`,
  `@constraint` and `@errors`, plus the definition of each of those directives used. A name that
  does not exist is listed as unknown, with a fix.
- **`search`**: every word (case-insensitive) must appear in the type's name or description, or in
  a field or enum value name or description. The answer is the SDL of the matching types, at most
  50; when more match it says so and tells the agent to narrow the search.

## `graphql_query`

Input `{ query: string, variables?: object, operationName?: string }`. The document is parsed and
validated against the caller's view, then run through `graxia.execute`, so operation limits, cost,
trusted documents, masking and field rate limits apply as they do on HTTP.

Refused before it runs, each with a `fix`:

| input                      | message                                   | fix                               |
| -------------------------- | ----------------------------------------- | --------------------------------- |
| a syntax error             | the parser's message                      | correct the syntax                |
| a mutation                 | A mutation cannot run in graphql_query.   | use `graphql_mutate`              |
| a subscription             | Subscriptions are not available over MCP. | send a query                      |
| `@defer` or `@stream`      | `@defer` is not available over MCP.       | remove the directive              |
| an unknown or hidden field | Cannot query field "x" on type "Y".       | call `graphql_schema`, correct it |

## `graphql_mutate`

Listed only with `mutations: true`; same input. A query is refused with a fix pointing to
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

With `trustedDocuments` in `strict` mode (the default in production) graxia refuses any document
that is not in the manifest, so `graphql_query` and `graphql_mutate` answer with that refusal.
Persisted operations as typed tools are planned: see the [roadmap](../roadmap.md).

## Cost of `can`

Without `can` the caller view is computed once, on the first request. With `can`, it is computed on
every request (the schema is printed and rebuilt for that caller's permissions). It is cheap for a
small schema; for a large one, keep `can` fast and expect a few milliseconds per request.
