# Plugins

A plugin is a plain object with a `name` and the hooks it needs. `definePlugin` types it.

```ts
import { definePlugin } from '@graxia/core';

export const timing = definePlugin({
	name: 'timing',
	onRequest: ({ state }) => {
		const start = performance.now();
		// returned function = after-hook
		return () => console.log(`took ${performance.now() - start}ms`);
	},
});
```

A plugin that needs part of the context uses the curried form, naming what it requires:

```ts
const auth = definePlugin<{ request: Request }>()({
	name: 'auth',
	onContext: ({ context }) => ({
		ua: context.request.headers.get('user-agent'),
	}),
});
```

Use `definePlugin({ ... })` when the plugin requires nothing (it cannot read a context field, and
`context.request` is a type error), and `definePlugin<Requires>()({ ... })` when it does. The curried
form exists because TypeScript has no partial type-argument inference: you cannot give `Requires`
explicitly and let the compiler infer what `onContext` adds in the same call, so the first call fixes
`Requires` and the second infers the rest. Both return the same plugin object.

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

## Stages that run over streams

`onSubscribe` runs around `subscribe` for a subscription served over server-sent events (see
[Subscriptions](./subscriptions.md)) or WebSocket (see [Subscriptions over WebSocket](./websocket.md)).

`onResultChunk` runs, before masking, for every payload sent on a stream:

- over server-sent events and WebSocket: each subscription event, and the single result of a query or
  a mutation, a failure before execution (parse, validation) included. Over WebSocket that failure
  reaches `onResultChunk` as the result that becomes the `error` message, so a hook sees it like it
  sees an SSE `next`;
- when a subscription's source throws after it has yielded: the last payload, `{ errors: [error] }` with
  the error as thrown (a `GraphQLError`, or an `Error` wrapped in one), reaches the hook before masking,
  over SSE and WebSocket alike. A chunk with `errors` and **no `data` key** is the source's failure, and
  always the last payload: a resolver error sends `{ data, errors }` and the stream goes on. The
  operation's signal aborts when the stream ends, whatever the cause (completion, a source failure, the
  client leaving, shutdown), with no reason, so it does not tell a failure apart. A hook that drops the
  errors with `setChunk` means nothing is reported for that failure. If a hook throws on this chunk,
  `onUnexpected` receives the source's error first, then the hook's, but only when the source's error is
  not a `GraphQLError`: a `GraphQLError` source with a throwing hook reports only the hook's error;
- over `multipart/mixed` (see [`@defer` and `@stream`](./incremental.md)): the initial and each
  subsequent payload of an incremental result. A query that is not incremental, over `multipart/mixed`
  or plain JSON, is answered as one plain response and its hooks do not run.

Each payload runs inside its operation's scope, so `getContext()` works in the hook. A failure
before the context exists (a parse or validation error) has no operation context yet: use
`tryGetContext()` there. `graxia.execute` and the test client do not run `onResultChunk`.

## Short-circuit and replacing steps

A hook can answer, or replace what a stage does, through its payload.

```ts
const gate = definePlugin({
	name: 'gate',
	onRequest: ({ request, respond }) => {
		if (!request.headers.has('authorization'))
			respond(new Response(null, { status: 401 }));
	},
	onParams: ({ params, setParams }) =>
		setParams({ ...params, operationName: params.operationName ?? 'Anon' }),
});
```

| Stage                      | Payload helpers                                                                                                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `onRequest`                | `serverContext`; `respond(response)` ends the stage; earlier after-hooks still run                                                                                                    |
| `onParams`                 | `setParams(params)`, `respond(response)`                                                                                                                                              |
| `onParse`                  | `serverContext`; `setParseFn(fn)`, `setDocument(doc)` (skips parsing)                                                                                                                 |
| `onValidate`               | `serverContext`; `setValidationFn(fn)`, `addRule(rule)`, `setResult(errors)` (skips validation)                                                                                       |
| `onExecute`, `onSubscribe` | `executeFn` (the function that will run: the last one set, else the engine's), `setExecuteFn(fn)`, `setResult(result)` (skips execution); the after-hook gets `{ result, setResult }` |
| `onResultChunk`            | `setChunk(chunk)`                                                                                                                                                                     |
| `onResponse`               | `setResponse(response)`                                                                                                                                                               |

Only `respond` stops a stage. The other setters (`setParams`, `setDocument`, `setParseFn`,
`setValidationFn`, `setResult`, `setChunk`, `setResponse`) leave later hooks running: the last write
wins, and the caller skips the step when `out.document`, `out.errors` or `out.result` is set.
`addRule` accumulates across plugins.

## Observing operations over WebSocket

`onExecute` and `onSubscribe` run for each operation of a socket, and the host's `serverContext`
(given to `graxia.upgrade`) is in `args.contextValue`. A query or mutation ends in its after-hook;
a subscription ends when `args.contextValue.signal` aborts (its after-hook only runs once the
stream is created). The full start/end snippet is in
[Observe each socket operation](./websocket.md#observe-each-socket-operation).

## Reading the host context before `onExecute`

`onRequest`, `onParse` and `onValidate` payloads carry a read-only `serverContext`: a copy graxia made of
what the host passed to `fetch`, `graxia.upgrade` or `serve({ serverContext })`, with `server` added and,
over a WebSocket, `connectionParams`. `onExecute` sees it too, through `args.contextValue`. Reading it in
`onValidate` ties a document that fails validation to its socket, which `onExecute` never sees.

```ts
import { definePlugin } from '@graxia/core';

// graxia.upgrade(request, server, { socketId: crypto.randomUUID() })
export const invalidDocuments = definePlugin()({
	name: 'invalid-documents',
	onValidate:
		({ serverContext }) =>
		({ errors }) => {
			if (errors?.length)
				console.warn(
					`socket ${serverContext['socketId']}: ${errors[0]?.message}`,
				);
		},
});
```

`serverContext` is untyped here: its values are `unknown`, so read a key with brackets and narrow it. Do not
mutate it: over a socket, `onRequest` sees the copy stored at the upgrade, so a change there reaches every
later operation of that socket, while `onParse` and `onValidate` get a fresh copy per operation. The other
stages keep reading the context from `args.contextValue` (`onExecute`, `onSubscribe`) or `context`
(`onContext`).

## Exempting a GET from the CSRF header

A plugin field `csrfExempt(request)` (not a hook) lets a plugin serve its own `GET` pages without the
CSRF header, provided its `onRequest` answers them with `respond`; otherwise core refuses with 403
`CSRF_HEADER_REQUIRED`. See [Security](./security.md#exempting-a-plugins-own-get-requests).

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

`setup` receives `{ plugins, transports, schema }`: `schema` is the instance's `GraphQLSchema` (so a plugin can
read it once, at boot, as `@graxia/envelop` does for Envelop's `onSchemaChange`), `plugins` lists the plugin names in execution order, and
`transports` (`{ sse: boolean, ws: boolean }`, read-only) tells which subscription transports the
instance has on, from its resolved `subscriptions.sse` and `subscriptions.ws` options. A plugin
that serves a client (a GraphiQL page, say) uses it to pick the transport without a setting.

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

const auth = definePlugin({
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
const tenant = definePlugin({
	name: 'tenant',
	onContext: () => ({ tenant: 'acme' }),
});

type Ctx = ContextOf<[typeof auth, typeof tenant]>; // { user: { id: string } } & { tenant: string }
```

`ContextOf` and `RequiresContext` take tuples (`[a, b]`, not `Plugin[]`). `RequiresContext<Plugins, HostCtx>` resolves to `never` when a plugin needs context the host (and
the plugins before it) do not provide. Returning something other than an object or nothing from
`onContext` throws a `GraxiaConfigError`.

**Checked against the schema**: `createGraxia` verifies that the context the `context` option, the
host's `serverContext` and the plugins build satisfies the schema's `createSchema<Ctx>` (see
[Context](./context.md#write-the-context-once), and `InferContext` to write it once). A plugin's
`definePlugin<Requires>` is still checked with `RequiresContext`, which you can assert yourself.
