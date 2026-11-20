# Troubleshooting: plugins and context

Plugin, request-state and context errors, headed by the message as it appears. The rest is in [Troubleshooting](./troubleshooting.md).

## Unexpected error.

A response carries `Unexpected error.` with `extensions.code: "INTERNAL_SERVER_ERROR"` and a
`correlationId`. A resolver threw something that is not an `exposedError` or a `GraphQLError`, or a
plugin hook, `context` or `execute` failed. The message is masked on purpose.

Find the cause: the `correlationId` equals the `x-request-id` response header, and `onUnexpected`
received the original error with the same id.

```ts
createGraxia({
	schema,
	onUnexpected: (error, { correlationId }) =>
		logger.error({ err: error, correlationId }),
});
```

In development the default logs it with `console.error`; in production nothing is logged until you
set `onUnexpected`. To show an error to the client, throw `exposedError`. See [Errors](./guide/errors.md).

## Duplicate plugin name "x" at indexes 0 and 2

Two plugins in `plugins` share a `name`. Names are unique; rename one, or remove the duplicate.

## Request state key "x" is required but was not set

`state.require(key)` ran before any hook set the key. Set it in an earlier hook (an `onRequest` of a
plugin ordered first with `enforce: 'pre'`), or use `state.get(key)` when it is optional.

## Plugin "x" onContext must return an object or nothing, got null

An `onContext` hook returned `null`, an array or a primitive. Return an object to add to the context,
or return nothing.

```ts
onContext: () => ({ user: null }); // not `null`
```

## Plugin "x" failed during setup: …

The plugin's `setup` threw; the original error is the `cause` and its message follows. The first
failing `setup` stops the sequence (later plugins never ran theirs). Nothing is thrown at creation:
`graxia.ready` rejects, the failure is reported once through `onUnexpected` with `phase: "setup"`,
and every request answers the generic 500 until the process is fixed. Fail fast at startup by
awaiting it:

```ts
const graxia = createGraxia({ schema, plugins: [db] });
await graxia.ready; // rejects with the GraxiaPluginError
```

Fix the cause (a missing peer, a bad option, an unreachable service). On `dispose()`, `onDispose`
runs only for the plugins whose `setup` succeeded. See [Plugins](./guide/plugins.md#setup-and-dispose).

## Type '{ user: string; }' is not assignable to type 'MaybePromise<{ user: string; n: number; }>'

A type error on the `context` option of `createGraxia`. The schema was built with
`createSchema<Ctx>()`, and the context that the `context` factory, the plugins and graxia build does
not satisfy `Ctx`. The three forms:

- A key is missing: `Type '{ user: string; }' is not assignable to type 'MaybePromise<{ user: string; n: number; }>'`,
  then `Property 'n' is missing in type '{ user: string; }' but required in type '{ user: string; n: number; }'`.
- A key has another type: `Type 'number' is not assignable to type 'string'`, on the key of the returned object.
- No `context` option at all: `Property 'context' is missing in type '{ schema: … }' but required in type
  '{ context: (init: ContextInit<…>) => MaybePromise<{ user: string; n: number; }>; }'`.

When the factory is a named function passed as a variable, the first line can show a long
intersection `(…) & (…)`; read the last line of the message, which names the missing or mistyped key.

The type in `MaybePromise<…>` is what the factory still has to return: the keys of `Ctx` that the
plugins, `serverContext` and graxia do not already provide.

Return the missing keys from the factory, or add the plugin that provides them. Writing the
context once avoids the drift:

```ts
const context = async ({ request }: ContextInit) => ({
	user: await authenticate(request),
});
type Ctx = InferContext<typeof context, typeof plugins>;
const schema = createSchema<Ctx>()({ typeDefs, resolvers });
createGraxia({ schema, context, plugins });
```

The check is skipped for a plain `GraphQLSchema`, a plugin list that is not a tuple, and a call
with an explicit type argument (do not write `createGraxia<…>`; type the host on the factory,
`ContextInit<{ db: Db }>`). See
[Context](./guide/context.md#write-the-context-once).

## getContext() called outside a graxia operation, or the instance was created with asyncContext: false

`getContext()` only works inside an operation (a resolver, or code one calls) and when `asyncContext`
is not `false`. Call it from a resolver, leave `asyncContext` on, or read the resolver's context
argument. See [Context](./guide/context.md).
