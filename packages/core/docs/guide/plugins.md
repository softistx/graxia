# Plugins

A plugin is a plain object with a `name` and the hooks it needs. `definePlugin` types it.

```ts
import { definePlugin } from '@graxia/core';

export const timing = definePlugin()({
	name: 'timing',
	onRequest: ({ state }) => {
		const start = performance.now();
		// returned function = after-hook
		return () => console.log(`took ${performance.now() - start}ms`);
	},
});
```

Stages, in order: `onRequest`, `onParams`, `onParse`, `onValidate`, `onContext`, `onExecute` (or
`onSubscribe`), `onResultChunk`, `onResponse`. `setup(api)` runs once at engine init; `onDispose()` runs once when
`graxia.dispose()` has drained, in reverse plugin order (every hook runs even if one throws, the
first error is rethrown; see [Context and shutdown](./context.md#dispose-and-draining)).

Every payload carries `responseHeaders: Headers`, merged into the final response (see [GraphQL over HTTP](./http.md#plugin-headers)).

## Ordering

Plugins run in the order given. `enforce: "pre"` moves a plugin first, `"post"` last; inside a group
the order is kept. Before-hooks run in that order, after-hooks in reverse. Two plugins with the same
`name` throw a `GraxiaConfigError` naming both indexes.

```ts
createGraxia({
	schema,
	plugins: [
		{ name: 'a', enforce: 'post' },
		{ name: 'b' },
		{ name: 'c', enforce: 'pre' },
	],
}); // runs c, b, a
```

## After-hooks

A hook of `onRequest`, `onParams`, `onParse`, `onValidate`, `onExecute` or `onSubscribe` may return a
function: it runs after the stage, in reverse plugin order, and receives the stage's outcome. Every
after-hook runs even if the stage itself, a later after-hook or the step in between threw (for
`onValidate`, a throwing validation rule included); the first error is rethrown afterwards and
answers a 500.

`onContext` and `onResponse` have **no after-hook**: `onContext` returns an object to merge, and
`onResponse` returns nothing (its type is `MaybePromise<void>`, so returning a function is a type
error) and replaces the response with `setResponse`. `onResponse` hooks run in plugin order on the
final response.

## Stages that run over event streams

`onSubscribe` and `onResultChunk` run for operations served over server-sent events (see
[Subscriptions](./subscriptions.md)): `onSubscribe` around `subscribe` for a subscription, and
`onResultChunk` for every payload sent (a query's single result too), before masking. Over plain JSON
HTTP they are not invoked. Incremental delivery (`@defer`, `@stream`) arrives in a later release (see
the [roadmap](../roadmap.md)).

## Short-circuit and replacing steps

A hook can answer, or replace what a stage does, through its payload.

```ts
const gate = definePlugin()({
	name: 'gate',
	onRequest: ({ request, respond }) => {
		if (!request.headers.has('authorization'))
			respond(new Response(null, { status: 401 }));
	},
	onParams: ({ params, setParams }) =>
		setParams({ ...params, operationName: params.operationName ?? 'Anon' }),
});
```

| Stage                      | Payload helpers                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------------------ |
| `onRequest`                | `respond(response)` ends the stage; earlier after-hooks still run                                      |
| `onParams`                 | `setParams(params)`, `respond(response)`                                                               |
| `onParse`                  | `setParseFn(fn)`, `setDocument(doc)` (skips parsing)                                                   |
| `onValidate`               | `setValidationFn(fn)`, `addRule(rule)`, `setResult(errors)` (skips validation)                         |
| `onExecute`, `onSubscribe` | `setExecuteFn(fn)`, `setResult(result)` (skips execution); the after-hook gets `{ result, setResult }` |
| `onResultChunk`            | `setChunk(chunk)`                                                                                      |
| `onResponse`               | `setResponse(response)`                                                                                |

Only `respond` stops a stage. The other setters (`setParams`, `setDocument`, `setParseFn`,
`setValidationFn`, `setResult`, `setChunk`, `setResponse`) leave later hooks running: the last write
wins, and the caller skips the step when `out.document`, `out.errors` or `out.result` is set.
`addRule` accumulates across plugins.

## Hook errors

A hook that throws does not abort its stage mid-way: the hooks after the thrower are skipped, the
after-hooks of the hooks that already ran still unwind in reverse order, and the request answers a
generic 500 (`Unexpected error.`, with the original error sent to `onUnexpected`). The error you
receive is the original thrown value, not wrapped. Only a `setup` error is wrapped, in a
`GraxiaPluginError` that names the plugin.

## Setup and dispose

`setup(api)` runs once, awaited, in plugin order, when the instance is created. If one throws,
the sequence stops there (later plugins do not run `setup`), `graxia.ready` rejects with a
`GraxiaPluginError` naming the plugin, and the failure is reported once through `onUnexpected`
with `phase: "setup"`. Requests then answer a 500 until the process is fixed and restarted.

```ts
const graxia = createGraxia({ schema, plugins: [db] });
await graxia.ready; // throws GraxiaPluginError: Plugin "db" failed during setup: ...
```

`onDispose()` runs only for the plugins whose `setup` succeeded, so a plugin whose setup failed
is never asked to close what it never opened.

## Per-request state

Typed keys into a bag (`RequestState`: `get`, `set`, `has`, `require`, `responseHeaders`) every hook of
one request shares. Two keys with the same name are distinct. The request's id is read with
`getRequestId(state)`.

```ts
import { createStateKey, definePlugin } from '@graxia/core';

export const userKey = createStateKey<{ id: string }>('user');

const auth = definePlugin()({
	name: 'auth',
	onRequest: ({ state }) => state.set(userKey, { id: '1' }),
	onParams: ({ state }) => {
		state.get(userKey); // { id: string } | undefined
		state.require(userKey); // throws GraxiaConfigError naming "user" when unset
	},
});
```

Over HTTP, `onRequest` sees the request's state. Each operation (the single one, or each entry of a
batch) then runs on a forked state: a child that reads through to the request state, writes only to
itself and shares `responseHeaders` and the request id. Sibling batch entries never see each other's
writes.

## Typed context

`onContext` returns an object that is shallow-merged into the context, in plugin order. Its type
reaches `onExecute` and `onSubscribe`, and `ContextOf` folds a list of plugins.

```ts
import { type ContextOf, definePlugin } from '@graxia/core';

const auth = definePlugin<{ request: Request }>()({
	name: 'auth',
	onContext: async () => ({ user: { id: '1' } }),
});
const tenant = definePlugin()({
	name: 'tenant',
	onContext: () => ({ tenant: 'acme' }),
});

type Ctx = ContextOf<[typeof auth, typeof tenant]>; // { user: { id: string } } & { tenant: string }
```

`ContextOf` and `RequiresContext` take tuples (`[a, b]`, not `Plugin[]`). `RequiresContext<Plugins, HostCtx>` resolves to `never` when a plugin needs context the host (and
the plugins before it) do not provide. Returning something other than an object or nothing from
`onContext` throws a `GraxiaConfigError`.

**Not checked in 0.1.0**: `createGraxia` does not verify, at compile time, that the context the
`context` option, the host's `serverContext` and the plugins build is what the schema's resolvers
(`createSchema<Ctx>`) or a plugin's `definePlugin<Requires>` expect. `RequiresContext` is a helper
you can assert with yourself; a missing key shows up at run time, so cover it with a test.
