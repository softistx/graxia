# Running Envelop plugins

```ts
import { createGraxia } from '@graxia/core';
import { fromEnvelop } from '@graxia/envelop';
import { useDepthLimit } from '@envelop/depth-limit';

createGraxia({
	schema,
	plugins: [fromEnvelop([useDepthLimit({ maxDepth: 10 })])],
}).serve();
```

`fromEnvelop(plugins, options?)` takes the list you would give `envelop()` and returns one graxia plugin. Options: `name`
(default `envelop`; two adapters in one instance need distinct names) and `enforce` (`'pre'` or `'post'`, where it runs among
the other plugins).

The plugins are checked when `fromEnvelop` is called, so a plugin graxia cannot run fails at boot, not on the first
request.

## Hook mapping

| Envelop hook                                                       | Runs at graxia stage | Notes                                                                                             |
| ------------------------------------------------------------------ | -------------------- | ------------------------------------------------------------------------------------------------- |
| `onPluginInit`                                                     | `fromEnvelop()` call | `addPlugin` inserts after the adder, recursively. `setSchema` is refused.                         |
| `onSchemaChange`                                                   | `setup`              | Called once with the schema. `replaceSchema` is refused.                                          |
| `onEnveloped`                                                      | `onParams`           | Once per operation (once per batch entry).                                                        |
| `onParse` (`setParsedDocument`, `setParseFn`)                      | `onParse`            | `setParseFn` keeps core's token limit. Its after-hook sees the document, or `null`.               |
| `onValidate` (`addValidationRule`, `setValidationFn`, `setResult`) | `onValidate`         | Validation errors answer 400. `replaceParseResult` and `setResult` in the after-hook are refused. |
| `onContextBuilding`                                                | `onContext`          | `extendContext`, `breakContextBuilding` and the after-hook work.                                  |
| `onExecute`, `onExecuteDone`                                       | `onExecute`          | `setExecuteFn`, `setResultAndStopExecution`, `setResult`.                                         |
| `onSubscribe`, `onSubscribeResult`                                 | `onSubscribe`        | `onNext`, `onEnd`, and `onSubscribeError` with `setError`.                                        |
| `instrumentation`, graphql-yoga hooks                              | not run              | Refused at boot, see [troubleshooting](../troubleshooting.md).                                    |

## The context

The context the Envelop hooks build on is `{ request, params, ...your host context }`. Keys the hooks add with
`extendContext` are merged into graxia's context and reach the resolvers. A `GraphQLError` thrown in
`onContextBuilding` answers `{ errors }` without running a resolver; any other error is a masked 500 reported to
`onUnexpected`, after the handlers registered with `registerContextErrorHandler` ran (they may `setError`).

graxia builds one context object per operation, so a plugin that keeps a reference to the context object across
hooks sees the one it was given at each hook, not an identical object. Known limit: `@envelop/generic-auth`'s
`extractPolicies` / `@policy` relies on that identity and is not supported. `serverContext` is not part of the early
context.

## Errors

- A `GraphQLError` thrown in a hook is the client's answer and keeps its message and `extensions.code`.
- A plain `Error` is unexpected: masked, and reported through `onUnexpected`.
- A `GraphQLError` with its own `extensions.code` thrown in `onParse` keeps it (core no longer relabels it
  `GRAPHQL_PARSE_FAILED`); syntax errors still do.
- `@envelop/generic-auth` errors keep their code and `extensions.http` but the HTTP status of an execution error stays
  200 under `application/graphql-response+json`.

## `@defer`, `@stream` and subscriptions

Envelop done-hooks receive an async iterable for incremental results, as in Envelop on graphql 17. `onNext` runs per
payload (each `@defer` payload over `multipart/mixed` and SSE), `onEnd` once when the stream ends, including when the client
leaves. Subscriptions use `onSubscribeResult` the same way, and `onSubscribeError` can `setError`.

## Migrating from graphql-yoga

1. Move every Envelop plugin from `createYoga({ plugins })` into `fromEnvelop([...])`.
2. Yoga's own plugins (`onRequest`, `onResultProcess`, ...) are refused: replace them with `definePlugin` from `@graxia/core`.
3. Pass the schema to `createGraxia({ schema })`; `useSchema` and `setSchema` are not needed.
4. CORS, GraphiQL and persisted operations have graxia options of their own (`trustedDocuments`, `@graxia/graphiql`).

## Tested plugins

All of them run on graphql 17.1 over a real server in this package's specs.

| Plugin                                 | Result                                                                                                                              |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `@envelop/depth-limit` 8.0.1           | Runs. A too-deep query answers 400.                                                                                                 |
| `@envelop/generic-auth` 12.0.1         | Runs in `protect-all`, `protect-granular` and `resolve-only`. Type the user with `fromEnvelop<{ currentUser: User }>`.              |
| `@envelop/response-cache` 10.0.1       | Runs: hits, invalidation by mutation, per-session entries. Needs a request on the context, which graxia provides.                   |
| `@envelop/persisted-operations` 11.0.1 | Runs when the client also sends a placeholder `query` (core rejects a request without one first). Prefer core's `trustedDocuments`. |
