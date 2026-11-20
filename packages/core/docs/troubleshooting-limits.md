# Troubleshooting: request limits

Parser, depth, alias, cost, body and batching limit errors, headed by the message as it appears. The rest is in [Troubleshooting](./troubleshooting.md).

## Document contains more than N tokens. Parsing aborted.

The query is larger than `limits.tokens` (15 000 by default). The error has `extensions.code:
"GRAPHQL_PARSE_FAILED"`, `limit` and `fix`. Split the operation, or raise the limit:

```ts
createGraxia({ schema, limits: { tokens: 30_000 } });
```

## Document is nested more than N levels deep. Parsing aborted.

The query nests deeper than `limits.nesting` (1 000 by default). Same code and `fix`; flatten the
document or raise `limits.nesting`. See [Limits and caches](./guide/limits-and-caches.md).

## Document is nested too deeply to parse.

A document under `limits.nesting` still overflowed the parser's stack (`nesting: false` or a
very high limit make it likely). It is a `GRAPHQL_PARSE_FAILED` error with a `fix`, never
`Unexpected error.`, and is not cached. Flatten the document, or lower `limits.nesting`.

## Operation depth N exceeds the limit of M.

The operation selects fields nested deeper than `limits.depth` (12 by default), fragments
expanded. A `GRAPHQL_VALIDATION_FAILED` error (HTTP 400) with `extensions.limit`
(`{ name: 'depth', max, actual }`) and `fix`. Ask for fewer nested fields, or raise it:

```ts
createGraxia({ schema, limits: { depth: 16 } }); // or false
```

## Operation has N aliases, over the limit of M.

More aliased fields than `limits.aliases` (30). Use fewer aliases or raise `limits.aliases`.
`extensions.limit.name` is `aliases`.

## Operation has N directives, over the limit of M.

More directive usages than `limits.directives` (50). `extensions.limit.name` is `directives`.

## Operation has N root fields, over the limit of M.

More root fields than `limits.rootFields` (20), `__typename` excluded. Split the operation
or raise it. `extensions.limit.name` is `rootFields`.

## The schema declares @cost(…) but graxia's limits.cost reads @cost(weight: Int!)

Your schema declares `@cost` or `@listSize` with another shape than graxia's (for example the IBM
form `directive @cost(weight: String!) on FIELD_DEFINITION`). The cost limit reads those directives
with its own definitions and would fail on every operation, so `createGraxia` throws a
`GraxiaConfigError`: `The schema declares @cost(<your arguments, with defaults>) but graxia's limits.cost reads @cost(weight: Int!). Rename or drop your directive, …`. The same message exists for `@listSize` (graxia reads `@listSize(assumedSize: Int, requireOneSlicingArgument: Boolean = true, sizedFields: [String!], slicingArguments: [String!])`); a different argument name, type or default value is a clash. Rename or drop your directive, or turn the
cost limit off:

```ts
createGraxia({ schema, limits: { cost: false } });
```

## Operation cost N exceeds the limit of M.

The cost of the operation is over `limits.cost.max` (5 000). The cost multiplies list fields
by their size: a slicing argument (`first: 100`), `assumedSize` or `limits.cost.defaultListSize`.
Request fewer items, give the field `@listSize(slicingArguments: ["first"])`, or raise it. The
check reads variables, so `first: $n` counts. `extensions.limit.name` is `cost`.

```ts
createGraxia({ schema, limits: { cost: { max: 20_000 } } }); // or cost: false
```

## Field Query.users requires one of its slicing arguments (first, last).

A list field declared with `@listSize(slicingArguments: [...])` was asked for without any of them
holding a valid value (absent, `null`, negative, not an integer, or an unprovided variable).
Pass one, or set `requireOneSlicingArgument: false` on the `@listSize` to fall back to
`assumedSize` / `limits.cost.defaultListSize`. `extensions.limit.name` is `cost`.

## limits.depth must be a positive integer (or false)

`limits.depth` is not an integer of at least 1. Pass one, or `false`.

## limits.aliases must be a positive integer (or false)

Same for `limits.aliases`.

## limits.directives must be a positive integer (or false)

Same for `limits.directives`.

## limits.rootFields must be a positive integer (or false)

Same for `limits.rootFields`.

## limits.cost must be false or an object ({ max, defaultListSize, objectCost, scalarCost })

`limits.cost` is neither `false` nor an object. Pass `false`, or the settings you want:

```ts
createGraxia({ schema, limits: { cost: { max: 10_000 } } });
```

## limits.cost.max must be a positive integer

Also `limits.cost.defaultListSize must be a positive integer`.

## limits.cost.objectCost must be a non-negative integer

Also `limits.cost.scalarCost must be a non-negative integer`.

## Cannot query field "x" on type "Query".  (`GRAPHQL_VALIDATION_FAILED`)

The document parsed but does not validate against the schema. Every such error carries
`extensions.code: "GRAPHQL_VALIDATION_FAILED"`, with `locations`. Fix the query, or the schema.

## limits.bodyBytes must be a positive integer

`limits.bodyBytes` is not an integer of at least 1. Pass a byte count, such as `1_048_576`.

## The request body could not be read. (400)

The body stream errored before graxia finished reading it, typically a host that wraps the request in
its own body limiter (or a dropped connection). graxia's own `limits.bodyBytes` answers 413 for both an
oversized `Content-Length` and a chunked body past the limit. Remove the host's limiter and set
`limits.bodyBytes`, see [Migrating](./guide/migrating-from-alxia-graphql.md#a-hosts-own-body-limit).

```ts
createGraxia({ schema, limits: { bodyBytes: 1_000_000 } });
```

## batching must be true, false or { limit: <positive integer> }

`batching` takes `true` (up to 10 operations per batch), `false` (off, the default) or `{ limit }` with an integer of at least 1. Anything else, such as `0`, `1.5`, `'yes'` or `{ limit: 0 }`, throws when `createGraxia` is called.

```ts
createGraxia({ schema, batching: true }); // or { limit: 25 }
```

## The request body is too large. (`BODY_TOO_LARGE`)

413. The body is over `limits.bodyBytes` (1 MiB by default), counted as it streams. Send a smaller body, or raise the limit: `createGraxia({ schema, limits: { bodyBytes: 4 << 20 } })`. Multipart bodies have their own limit, `uploads.bodyBytes` (`UPLOAD_TOO_LARGE`).

## The Content-Type must be application/json (UTF-8). (`UNSUPPORTED_MEDIA_TYPE`)

415. A POST body is read as JSON only. Send `Content-Type: application/json` (a charset, if any, must be UTF-8).

## The request body could not be read. / The request body is not valid UTF-8. (`BODY_UNREADABLE`)

400. The stream failed (the client aborted) or the bytes are not UTF-8. Re-send the body encoded as UTF-8.

## The request body is not valid JSON. (`INVALID_JSON`)

400. The body does not parse. Send `{ "query": "..." }`.

## Telling refusals apart

Each of these refusals, and the 404, 405, 406 and batch ones, has a stable `extensions.code`: see
[Refusal codes](./guide/http.md#refusal-codes). Match on the code, not on the message.
