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
`GRAPHQL_VALIDATION_FAILED` errors. These limits bound parsing; they are not operation limits
(depth, aliases, complexity), which are planned (see the [roadmap](../roadmap.md)).

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
