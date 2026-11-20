# Context, cancellation and shutdown

Every operation gets its own context, its own cancellation signal, and is tracked so that
`dispose()` can drain it.

## How the context is built

For each operation (each entry of a batch included), in this order:

1. `serverContext`: what the host passed, `graxia.fetch(request, serverContext)`, or `{ server }`
   (Bun's server) when started with `graxia.serve()`.
2. The `context` option, merged over it: `{ ...serverContext, ...(await context(init)) }`.
3. The `onContext` plugin hooks, each merging what it returns.
4. `signal`, set last, always the operation's own signal.

The object is built again for every operation and never shared: a batch of three entries runs
with three contexts, so a plugin or resolver that mutates its context cannot leak into a sibling.

## Write the context once

Declare the factory, derive the type from it, and use that type for the schema. The resolver's
third argument is the context, typed.

```ts
import {
	type ContextInit,
	createGraxia,
	createSchema,
	definePlugin,
	type InferContext,
} from '@graxia/core';

const tenant = definePlugin({
	name: 'tenant',
	onContext: ({ request }) => ({
		tenant: request.headers.get('x-tenant') ?? 'public',
	}),
});
const plugins = [tenant] as const;

const context = async ({ request }: ContextInit) => ({
	user: await authenticate(request), // { id: string } | null
});

// { user: … } & { tenant: string } & { signal: AbortSignal }
type Ctx = InferContext<typeof context, typeof plugins>;

const schema = createSchema<Ctx>()({
	typeDefs: 'type Query { whoami: String }',
	resolvers: {
		Query: { whoami: (_root, _args, ctx) => `${ctx.tenant}/${ctx.user?.id}` },
	},
});

const graxia = createGraxia({ schema, context, plugins });
Bun.serve({ port: 3000, fetch: graxia.fetch });
```

`InferContext<Make, Plugins, HostCtx>` is what the factory returns (awaited), what the plugins add
(`ContextOf`, a tuple, so declare the list `as const` or inline), the `serverContext` type the
factory's `ContextInit<…>` declares, and what graxia always adds (`CoreContext`, the `signal`). Without a factory, use
`InferContext<undefined, typeof plugins>` or `InferContext` alone. `ContextFactory<HostCtx>` is the type of the
`context` option itself, for a factory declared apart from `createGraxia` (`const context: ContextFactory = …`).

### The host's `serverContext`

Annotate the factory with the host's type, `ContextInit<{ tenant: string }>`: `InferContext` reads
it, and `fetch`, `execute` and `serve` then require that `serverContext`. Never write
`createGraxia<…>`: an explicit type argument switches the context check off.

```ts
const context = ({
	request,
	serverContext,
}: ContextInit<{ tenant: string }>) => ({
	user: request.headers.get('x-user') ?? 'anonymous',
	tenant: serverContext.tenant,
});
type Ctx = InferContext<typeof context>; // { user: string; tenant: string; … }

const graxia = createGraxia({
	schema: createSchema<Ctx>()({ typeDefs, resolvers }),
	context,
});
Bun.serve({
	port: 3000,
	fetch: (request) => graxia.fetch(request, { tenant: 'acme' }),
});
```

### What the compiler checks

`createGraxia` compares the schema's `createSchema<Ctx>` type with the context it builds. Keys the
plugins, `serverContext` and graxia provide are taken into account; the rest must come from the
`context` factory.

- A `createSchema<Ctx>()` schema whose context needs a key nobody provides, or provides with another
  type, is a type error on `context` (a missing `context` option is "Property 'context' is missing").
- A plain `GraphQLSchema`, or `createSchema()` without `Ctx`, is not checked.
- A plugin list that is not a tuple (`GraxiaPlugin[]`) is not checked either.
- Do not write `createGraxia<…>`: an explicit type argument stops TypeScript inferring the others
  and turns the check off. Type the host on the factory, as above.

The errors are listed in [Troubleshooting](../troubleshooting.md).

`ContextInit` is `{ request, serverContext, params, signal }`.

## Cancellation: `signal`

Each operation has an `AbortSignal` that aborts when the client disconnects (`request.signal`) or
when `dispose()` gives up waiting (see below). It is `signal` in `ContextInit`, `signal` in the
context, and is given to graphql's `execute` as `abortSignal`, so graphql stops resolving and
rejects the pending work. An open event stream (a subscription) is ended at once by `dispose()`: it
sends `complete`, then the signal aborts, without waiting for `shutdownTimeout` (see
[Subscriptions](./subscriptions.md#cancellation-and-shutdown)).

```ts
const resolvers = {
	Query: {
		report: async (_root, _args, { signal }) => {
			const res = await fetch('https://example.com/slow', { signal });
			return res.text();
		},
	},
};
```

An aborted operation answers `{"errors":[{"message":"The operation was aborted.","extensions":{"code":"OPERATION_ABORTED"}}]}`
with status 499 (the client's request was aborted) or 503 (otherwise: the server is shutting down). It is not an unexpected
failure: `onUnexpected` is not called.

## `getContext()` for code far below a resolver

The resolver's third argument is the way to reach the context. When a helper or a logger is called
deep below a resolver and threading the context through would be noise, `getContext()` is the
shortcut. Inside an operation, `getContext()` returns the same object the resolvers receive, so helpers and
loggers need no extra parameter. It is backed by `AsyncLocalStorage` (`node:async_hooks`).

```ts
import { getContext, tryGetContext } from '@graxia/core';

export function currentUser(): string | undefined {
	return getContext<Ctx>().user?.id;
}

export const log = (message: string) =>
	console.log(tryGetContext<Ctx>()?.user?.id ?? 'no operation', message);
```

- `getContext()` throws a `GraxiaConfigError` outside an operation ("getContext() called outside a graxia operation…").
- `tryGetContext()` returns `undefined` instead.
- `asyncContext: false` on `createGraxia` skips the `AsyncLocalStorage` entirely; `getContext()` then
  throws, its message naming the option. Pass the context explicitly in that case.

The store covers the plugins' `onExecute` hooks and the execution itself, not `onRequest`,
`onParams` or the earlier stages. Prefer the explicit context argument. The cost of the store is measured in
`packages/core/bench/als.ts` (see the pull request that added it).

## `dispose()` and draining

```ts
const graxia = createGraxia({ schema, shutdownTimeout: 5_000 });
const server = graxia.serve({ port: 3000 });

process.on('SIGTERM', async () => {
	await graxia.dispose(); // or: await graxia.dispose({ timeout: 2_000 })
	process.exit(0);
});
```

`dispose(options?)` does, in order:

1. Stops accepting work: a request arriving now answers `503` with
   `{"errors":[{"message":"Server is shutting down.","extensions":{"code":"SHUTTING_DOWN"}}]}` and
   `connection: close`.
2. Calls `server.stop()` (not forced) on every server started with `serve()`.
3. Ends the open event streams at once (each sends `complete`, then its `signal` aborts; see
   [Subscriptions](./subscriptions.md#cancellation-and-shutdown)), then waits for the other in-flight operations to settle, up to `timeout` milliseconds (default
   `shutdownTimeout`, 10 000). Then it aborts their `signal` and waits at most `timeout` more. An
   operation that ignores its signal and is still pending then is reported through `onUnexpected`
   (one error, "dispose: N operation(s) did not settle after abort") and does not block the rest.
4. Waits for the plugins' `setup` to finish, then runs every plugin's `onDispose()` in reverse plugin order. Only the plugins whose `setup` succeeded are
   disposed. Every hook runs even when one throws; the first error is rethrown afterwards.

A host that owns `Bun.serve` stops its server itself after `dispose()` (it stops only the servers `serve()` started); the
[host-embedding example](https://github.com/softistx/graxia/tree/develop/examples/host-embedding) shows readiness, `dispose()` and `server.stop()` in order.

A second call returns the same promise. `graxia` also implements `Symbol.asyncDispose`:

```ts
{
	await using graxia = createGraxia({ schema });
	// …
} // dispose() runs here
```

A plugin releases what its `setup` opened:

```ts
const db = definePlugin({
	name: 'db',
	setup: async () => {
		await pool.connect();
	},
	onDispose: async () => {
		await pool.end();
	},
});
```
