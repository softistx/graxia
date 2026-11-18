# Limits and caches

Before a document is parsed, graxia bounds it; once parsed, it keeps the result. Both are
built by `createDocumentPipeline`, which drives the `onParse` and `onValidate` plugin stages.

```ts
import { createDocumentPipeline, createPluginEngine } from '@graxia/core';

const pipeline = createDocumentPipeline({
  schema,
  engine: createPluginEngine(plugins),
  limits: { tokens: 15_000, nesting: 1_000 },
  caches: { parse: { maxBytes: 64 * 1024 * 1024, max: 1024, ttlMs: 3_600_000 }, validation: {} },
});

const parsed = await pipeline.parse({ source, state, request });
if (parsed.errors) return reply(parsed.errors); // GRAPHQL_PARSE_FAILED
const checked = await pipeline.validate({
  document: parsed.document!,
  cacheKey: parsed.cacheKey, // set only for the default parse
  state,
  request,
});
```

A step returns `{ document }` or `{ errors }`. `error` carries a value thrown by a plugin
hook, unmasked (the caller masks it). The after-hooks of `onParse` / `onValidate` receive the
outcome.

## Parse limits

| Option           | Default | Meaning                                                           |
| ---------------- | ------- | ----------------------------------------------------------------- |
| `limits.tokens`  | 15 000  | Most tokens (graphql 17 `parse(source, { maxTokens })`)           |
| `limits.nesting` | 1 000   | Most `{`, `(`, `[` levels, counted on the raw source before parse |

`false` turns a limit off. Strings, block strings and comments are not counted for nesting.
Every failure is a `GraphQLError` with `extensions.code = 'GRAPHQL_PARSE_FAILED'` (exported as `PARSE_FAILED`); the token
and nesting cases add `extensions.limit` and `extensions.fix`. A parser stack overflow
(`RangeError`) is reported the same way, never thrown; it carries `fix` but no `limit`, and is
not cached.

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
- `validate` uses the cache only with the `cacheKey` that `parse` returned, which exists only
  for the default parse of the source (not after `setParseFn` or `setDocument`).
- The validation cache is skipped when a plugin adds rules (`addRule`), swaps the validation
  function, or when the document did not come from a source string.
- `setDocument` skips parsing and `setResult` skips validation.

`createLruCache` (a weighted LRU with a ttl and an injectable clock) is exported for reuse.
