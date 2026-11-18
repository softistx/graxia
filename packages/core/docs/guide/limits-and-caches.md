# Limits and caches

Before a document is parsed, graxia bounds it; once parsed, it keeps the result. Both are
configured on `createGraxia` and apply to every operation, including those of `graxia.execute`
(for a string document).

```ts
createGraxia({
	schema,
	limits: { tokens: 15_000, nesting: 1_000, bodyBytes: 1_048_576 },
	caches: {
		parse: { maxBytes: 64 * 1024 * 1024, max: 1024, ttlMs: 3_600_000 },
		validation: {},
	},
});
```

A failed parse or validation answers the client with `GRAPHQL_PARSE_FAILED` or
`GRAPHQL_VALIDATION_FAILED` errors. The parse limits bound parsing; the
[operation limits](#operation-limits) below bound what an operation asks for.

The `onParse` and `onValidate` plugin stages run around these steps; their after-hooks receive the
outcome and run even when a validation rule throws.

## A key-value cache for your own code

`createMemoryCache` is a small asynchronous key-value store (LRU, per-entry time to live) behind the
`KeyValueCache` contract. Nothing in graxia consumes it yet; upcoming features (persisted queries,
response caching) take one, and your own plugins can use it today. `redisCache` from
`@graxia/redis` implements the same contract across processes.

```ts
import { createMemoryCache } from '@graxia/core';

const cache = createMemoryCache({ maxEntries: 500 });
await cache.set('greeting', 'hello', { ttlMs: 60_000 });
await cache.get('greeting'); // 'hello'
await cache.delete('greeting'); // true
```

Values are strings by default (serialise yourself); `createMemoryCache<V>()` stores any `V`.
`maxEntries` defaults to 1000; an expired entry is dropped when read.

## Parse limits

| Option           | Default | Meaning                                                           |
| ---------------- | ------- | ----------------------------------------------------------------- |
| `limits.tokens`  | 15 000  | Most tokens (graphql 17 `parse(source, { maxTokens })`)           |
| `limits.nesting` | 1 000   | Most `{`, `(`, `[` levels, counted on the raw source before parse |

`false` turns a limit off. Strings, block strings and comments are not counted for nesting.
Every failure is a `GraphQLError` with `extensions.code = 'GRAPHQL_PARSE_FAILED'`; the token
and nesting cases add `extensions.limit` and `extensions.fix`. A parser stack overflow
(`RangeError`, a document nested just under `limits.nesting` that still overflows the parser) is
reported the same way, never thrown and never masked as `Unexpected error.`; it carries `fix` but
no `limit`, and is not cached.

## Operation limits

On by default, so an operation over them is refused before it executes. Each is a positive
integer, or `false` to turn it off; anything else throws a `GraxiaConfigError` when
`createGraxia` runs.

| Option              | Default | Counts                                                           |
| ------------------- | ------- | ---------------------------------------------------------------- |
| `limits.depth`      | 12      | The deepest field selection; root fields are depth 1             |
| `limits.aliases`    | 30      | Aliased fields                                                   |
| `limits.directives` | 50      | Directive usages                                                 |
| `limits.rootFields` | 20      | Fields of the operation's root selection (`__typename` excluded) |
| `limits.cost`       | on      | The [cost](#cost) of the operation (`false` turns it off)        |

All four count through fragments and inline fragments: a fragment spread twice counts twice.
The walk is memoised per fragment, so a document of fragments that each spread the previous
one twice stays linear, and a fragment cycle (reported by validation) cannot hang it.
`__typename` adds no depth, and the `__schema` / `__type` subtrees count for nothing, so GraphiQL's
introspection query passes the defaults.

A refusal is a `GRAPHQL_VALIDATION_FAILED` error (HTTP 400, an `error` message over WebSocket,
`next` then `complete` over server-sent events), one per limit exceeded, with `extensions.limit`
(`{ name, max, actual }`) and `extensions.fix`:

```json
{
	"message": "Operation depth 14 exceeds the limit of 12.",
	"extensions": {
		"code": "GRAPHQL_VALIDATION_FAILED",
		"limit": { "name": "depth", "max": 12, "actual": 14 },
		"fix": "Ask for fewer nested fields or raise limits.depth."
	}
}
```

Size them from your own clients' largest legitimate operation, plus headroom: log the
`actual` of refusals while you tune.

```ts
createGraxia({
	schema,
	limits: { depth: 8, aliases: 10, directives: false, rootFields: 10 },
});
```

depth, aliases, directives and rootFields are validation rules, so the validation cache still
serves them (the limits are fixed per instance). A plugin's `onValidate` rules keep working.

### Cost

The cost follows the `@cost` and `@listSize` directives (the IBM GraphQL cost directive
design, as Apollo and Hot Chocolate read them). `createSchema` adds their definitions unless your
SDL declares them; for a `GraphQLSchema` you build yourself, add `costDirectives`. A schema
without the directives still gets the default costs.

```graphql
type Query {
	users(first: Int): [User!]!
		@listSize(slicingArguments: ["first"], assumedSize: 20)
	report: Report @cost(weight: 50)
	orders(first: Int): OrderConnection
		@listSize(slicingArguments: ["first"], sizedFields: ["edges"])
}
```

```ts
createGraxia({
	schema,
	limits: {
		cost: { max: 5_000, defaultListSize: 10, objectCost: 1, scalarCost: 0 },
	},
});
```

- A field costs its own `@cost` weight, else its return type's `@cost` weight, else
  `objectCost` (object, interface, union) or `scalarCost` (scalar, enum).
- A list field multiplies its items by the list size: the largest value of its slicing
  arguments (`slicingArguments`, a name or a dotted path into an input such as `page.size`), else
  `assumedSize`, else `defaultListSize`. A weight written on the field itself is paid once; one from
  the type or the defaults is paid per item. `sizedFields` gives the connection's list fields (`edges`,
  `nodes`) that size instead.
- The slicing arguments read the request's variable values (and the variable defaults), so
  `first: $n` cannot get around the limit. That is why cost is checked per request, after validation
  and before execution, on every transport, rather than as a validation rule.
- `@defer` and `@stream` cost the full operation. Introspection costs nothing. Cost is a
  conservative upper bound: fields in every branch of an abstract type are summed.
- `@cost` on an argument or an input field is accepted by the schema but not counted;
  `requireOneSlicingArgument` is declared but not enforced.

The refusal reads `Operation cost 7200 exceeds the limit of 5000.`, with
`limit: { name: 'cost', max: 5000, actual: 7200 }`.

`computeOperationCost({ schema, document, operationName?, variables?, options? })` returns the
number, for a plugin or a test.

## Validation errors

Validation errors are graphql's own, each with `extensions.code = 'GRAPHQL_VALIDATION_FAILED'`
(added when a rule did not set a code). They are cached with that code.

## Caches

| Option                  | Default | Meaning                                             |
| ----------------------- | ------- | --------------------------------------------------- |
| `caches.parse.maxBytes` | 64 MiB  | Total weight; a source weighs its UTF-16 length x 2 |
| `caches.parse.max`      | 1 024   | Most entries                                        |
| `caches.parse.ttlMs`    | 1 h     | Entry lifetime, checked on read                     |
| `caches.validation.*`   | same    | One cache per schema (`WeakMap`)                    |

`caches: false` disables both; `caches: { parse: false }` disables one.

- The parse cache is keyed by the source string and also keeps parse failures, so a bad
  document is not lexed again. A source heavier than `maxBytes / 8` is not cached.
- The validation cache budget is per schema: N schemas can hold N x `maxBytes`.
- The weight is an estimate of the key only; a parsed document costs several times its
  source, so size `maxBytes` with that in mind.
- A parse function set by a plugin (`setParseFn`) bypasses the parse cache, because its output
  is not a function of the source alone. The limits still apply.
- The validation cache is used only for the default parse of the source (not after `setParseFn`
  or `setDocument`).
- The validation cache is skipped when a plugin adds rules (`addRule`), swaps the validation
  function, or when the document did not come from a source string.
- `setDocument` skips parsing and `setResult` skips validation.
