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
`onSubscribe`), `onResultChunk`, `onResponse`. `setup(api)` runs once at engine init.

Every payload carries `responseHeaders: Headers`, merged into the final response (see [GraphQL over HTTP](./http.md#plugin-headers)).

## Ordering

Plugins run in the order given. `enforce: "pre"` moves a plugin first, `"post"` last; inside a group
the order is kept. Before-hooks run in that order, after-hooks in reverse. Two plugins with the same
`name` throw a `GraxiaConfigError` naming both indexes.

```ts
import { orderPlugins } from '@graxia/core';

orderPlugins([
	{ name: 'a', enforce: 'post' },
	{ name: 'b' },
	{ name: 'c', enforce: 'pre' },
]);
// c, b, a
```

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

A stage runner never rejects for a hook error. It returns `{ out, error?, runAfter }`: hooks after
the thrower are skipped, `error` is the original thrown value (not wrapped), and `runAfter(done)`
still unwinds the after-hooks of the hooks that ran before it, in reverse order. The caller decides
what to do with `error`. Only a `setup` error is wrapped, in a `GraxiaPluginError` that names the
plugin.

```ts
const outcome = await engine.runners.onRequest({ request, state });
if (outcome.error) console.error(outcome.error);
await outcome.runAfter({ response: outcome.out.response });
```

## Per-request state

Typed keys into a bag every hook of one request shares. Two keys with the same name are distinct.

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
batch) then runs on `state.fork()`: a child that reads through to the request state, writes only to
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

## Running the engine

`createPluginEngine` is what the transports call; most applications never do.

```ts
import { createPluginEngine, RequestState } from '@graxia/core';

const engine = createPluginEngine([timing, gate]);
await engine.init();
const outcome = await engine.runners.onRequest({
	request,
	state: new RequestState(),
});
outcome.out.response; // set when a hook answered
await outcome.runAfter({ response: outcome.out.response });
```

`engine.has("onExecute")` tells whether any plugin defines a stage, so a transport can skip it.
