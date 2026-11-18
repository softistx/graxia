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

The compiler does not check that the context you build matches what the schema's resolvers (the
`createSchema<Ctx>` type) or the plugins need: that check does not exist in 0.1.0, so a missing key
is `undefined` at run time. Cover it with a test that runs the operation (`graxia.execute`).

The object is built again for every operation and never shared: a batch of three entries runs
with three contexts, so a plugin or resolver that mutates its context cannot leak into a sibling.

```ts
import { createGraxia, createSchema } from '@graxia/core';

const schema = createSchema<{ tenant: string; user: string }>()({
	typeDefs: 'type Query { whoami: String }',
	resolvers: {
		Query: { whoami: (_root, _args, ctx) => `${ctx.tenant}/${ctx.user}` },
	},
});

const graxia = createGraxia<{ tenant: string }>({
	schema,
	context: ({ request, serverContext }) => ({
		user: request.headers.get('x-user') ?? 'anonymous',
		tenant: serverContext.tenant,
	}),
});

Bun.serve({
	port: 3000,
	fetch: (request) => graxia.fetch(request, { tenant: 'acme' }),
});
```

`ContextInit` is `{ request, serverContext, params, signal }`. The resolver's third argument is
the primary, explicit way to reach the context.

## Cancellation: `signal`

Each operation has an `AbortSignal` that aborts when the client disconnects (`request.signal`) or
when `dispose()` gives up waiting (see below). It is `signal` in `ContextInit`, `signal` in the
context, and is given to graphql's `execute` as `abortSignal`, so graphql stops resolving and
rejects the pending work.

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

## `getContext()` without passing the context down

Inside an operation, `getContext()` returns the same object the resolvers receive, so helpers and
loggers need no extra parameter. It is backed by `AsyncLocalStorage` (`node:async_hooks`).

```ts
import { getContext, tryGetContext } from '@graxia/core';

export function currentUser(): string {
	return getContext<{ user: string }>().user;
}

export const log = (message: string) =>
	console.log(
		tryGetContext<{ user: string }>()?.user ?? 'no operation',
		message,
	);
```

- `getContext()` throws a `GraxiaConfigError` outside an operation ("getContext() called outside a graxia operation…").
- `tryGetContext()` returns `undefined` instead.
- `asyncContext: false` on `createGraxia` skips the `AsyncLocalStorage` entirely; `getContext()` then
  throws, its message naming the option. Pass the context explicitly in that case.

The store covers the plugins' `onExecute` hooks and the execution itself, not `onRequest`,
`onParams` or the earlier stages. Prefer the explicit context argument; use `getContext()` where
threading it through would be noise. The cost of the store is measured in
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
3. Waits for the in-flight operations to settle, up to `timeout` milliseconds (default
   `shutdownTimeout`, 10 000). Then it aborts their `signal` and waits at most `timeout` more. An
   operation that ignores its signal and is still pending then is reported through `onUnexpected`
   (one error, "dispose: N operation(s) did not settle after abort") and does not block the rest.
4. Waits for the plugins' `setup` to finish, then runs every plugin's `onDispose()` in reverse plugin order. Only the plugins whose `setup` succeeded are
   disposed. Every hook runs even when one throws; the first error is rethrown afterwards.

A second call returns the same promise. `graxia` also implements `Symbol.asyncDispose`:

```ts
{
	await using graxia = createGraxia({ schema });
	// …
} // dispose() runs here
```

A plugin releases what its `setup` opened:

```ts
const db = definePlugin()({
	name: 'db',
	setup: async () => {
		await pool.connect();
	},
	onDispose: async () => {
		await pool.end();
	},
});
```
