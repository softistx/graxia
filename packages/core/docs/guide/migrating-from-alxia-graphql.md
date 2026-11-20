# Migrating from `@alxia/graphql`

`@alxia/graphql` mounts GraphQL Yoga on an alxia app. `@graxia/core` is its replacement for a host
that owns `Bun.serve` (or any `fetch` router): the same protections and transports, on graphql 17,
with no engine underneath that the host does not see. This page maps each option and says where
graxia does something different on purpose. A runnable host is in
[`examples/host-embedding`](https://github.com/softistx/graxia/tree/develop/examples/host-embedding).

## Why a major

The engine changes (Yoga to graxia) and graphql 16 is dropped: every plugin, context type and error
shape is graxia's. Plan it as a migration, not a bump: the table below is the checklist, and the
last section proves each line with a spec.

```sh
bun remove @alxia/graphql graphql-yoga graphql-ws
bun add @graxia/core graphql@^17.1.0
```

## Mounting

Before, the endpoint was a route of the alxia app:

```ts
const app = alxia().plugin((app) =>
	graphql(app, { schema, path: '/gql', ws: true }),
);
```

After, the host builds the instance once and calls it from its own route. One import, one call:

```ts
import { createGraxia } from '@graxia/core';

const graxia = createGraxia({ schema, path: '/api/gql' });

Bun.serve({
	routes: {
		'/api/gql': (request, server) =>
			graxia.isUpgrade(request)
				? graxia.upgrade(request, server)
				: graxia.fetch(request),
	},
	websocket: graxia.websocket,
});
```

`path` is the whole path the host routes (no prefix is added); `path: false` serves any path. The
example adds a typed host context, headers and cookies, CORS and a graceful shutdown.

## Options

| `@alxia/graphql`                       | `@graxia/core`                                                                                                                                           |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `path`                                 | `path` (the full path, or `false` for any path)                                                                                                          |
| `schema`, `GraphQLContext<typeof app>` | `createSchema<Ctx>()({ typeDefs, resolvers })`, with `Ctx = InferContext<typeof context>` ([Context](./context.md))                                      |
| Yoga `context`                         | `context: ({ request, serverContext, signal }: ContextInit<Host>) => …`; the host passes `fetch(request, host)`                                          |
| `maxTokens`, `maxNesting`              | `limits: { tokens, nesting }` ([Limits and caches](./limits-and-caches.md))                                                                              |
| `parseCache`                           | `caches: { parse, validation }`, or `caches: false`                                                                                                      |
| `bodyLimit`                            | `limits: { bodyBytes }`                                                                                                                                  |
| `ws: true \| { path?, keepAlive? }`    | `subscriptions: { ws: true \| { keepAliveMs, maxPayloadBytes, onConnect, … } }` and `graxia.upgrade` (same path); `keepAlive: false` is `keepAliveMs: 0` |
| `ide`, `graphiql`, `sandbox`           | the [`@graxia/graphiql`](https://github.com/softistx/graxia/tree/develop/packages/graphiql#readme) plugin, see [Explorer](#explorer)                     |
| `plugins` (Envelop, Yoga)              | graxia `plugins` ([Plugins](./plugins.md)); Envelop plugins through `fromEnvelop` from `@graxia/envelop`                                                 |
| Yoga `maskedErrors`                    | `maskErrors`, `maskError`, `onUnexpected` ([Errors](./errors.md))                                                                                        |
| Yoga `batching`                        | `batching: true \| { limit }` (`true` is 10)                                                                                                             |
| `requestId`                            | always on, see [Request id and logs](#request-id-and-logs)                                                                                               |
| `graphqlExecutor`                      | `graxia.execute({ document, variables, signal })` ([Testing](./testing.md))                                                                              |
| `fieldRateLimit`, `limitFromStore`     | the same names from `@graxia/core` ([Rate limiting](./rate-limiting.md))                                                                                 |
| `sameOrigin()`                         | `csrf: { sameOrigin: true \| { allowedOrigins, crossOrigin } }` ([Security](./security.md))                                                              |
| `createTestClient`                     | `createTestClient` from `@graxia/core/testing`                                                                                                           |
| `cors`                                 | none, see [CORS](#cors)                                                                                                                                  |
| `logging`                              | none, see [Request id and logs](#request-id-and-logs)                                                                                                    |

## What stays in `@alxia/graphql`

`oncePerRequest`, `freshPerMutation`, `clearRequestCache` and `boundedStream` are conventions of an
alxia app, not engine features. They keep working beside graxia because each operation has one
stable context object (`getContext()` and the resolvers' context are the same reference, deferred
fields included): key a cache on it with a `WeakMap`, as they do.

## Setting a header or a cookie

In `@alxia/graphql` a resolver wrote to `context.set` (`set.headers`, `set.cookies`), a value alxia
built for it. graxia has no built-in `set`: the host puts its own in `serverContext` and merges it
after `fetch`, so it stays in control of what a resolver may touch. Keep the name and the resolvers
do not change.

```ts
const graxia = createGraxia({
	schema,
	context: ({ serverContext }: ContextInit<{ set: Headers }>) => ({
		set: serverContext.set,
	}),
});

const set = new Headers();
const response = await graxia.fetch(request, { set });
for (const [name, value] of set) response.headers.append(name, value);
```

Only a single result is still in the host's hands; a streamed response (SSE, multipart) has left, and
a socket has none, so `set` is ignored there. The example does it with a header bag and
`Bun.CookieMap`.

## Reporting operations

Yoga logged operations as lines. graxia reports them as telemetry spans (`graphql.request`, one
`graphql.operation` per operation, batch and WebSocket included) on the optional
`@softistx/telemetry` peer ([Telemetry](./telemetry.md)). A host that still wants a log line writes
a plugin:

```ts
const logOperations = definePlugin({
	name: 'log-operations',
	onExecute: ({ args }) => {
		const started = performance.now();
		return ({ result }) => {
			const failed = result !== undefined && 'errors' in result;
			console.info(
				`${args.operationName ?? 'anonymous'} ${failed ? 'failed' : 'ok'} ${Math.round(performance.now() - started)}ms`,
			);
		};
	},
});
```

## Request id and logs

A client's `x-request-id` is never trusted in either library. alxia turned Yoga's id off; graxia
always answers with its own `x-request-id` (the `correlationId` of a masked error), generated per
request, readable with `getRequestId()`. graxia writes nothing to the console for a request, whatever
its status. Unexpected failures go to `onUnexpected` (`console.error` by default, silent when
`NODE_ENV=production`).

## Explorer

`ide`, `graphiql` and `sandbox` are replaced by the `@graxia/graphiql` plugin: `graphiql()` is on in
development and off in production, with a CSP that names no external source. Apollo Sandbox is the
`apolloSandbox()` plugin, and `sandboxContentSecurityPolicy` is the exact policy it needs. There is
no `renderSandbox` hook: pass the plugin.

## CORS

graxia has no `cors` option: it never sets an `access-control-*` header and answers `OPTIONS` with
405. CORS belongs to the host, which knows its origins, in front of `fetch` (a preflight answered,
the headers added to the response). The example's `cors.ts` is a working one.

## Peers

Nothing to install beyond `graphql`: the WebSocket protocol is implemented in the package (remove
`graphql-ws` and `graphql-yoga`), and `@softistx/telemetry` is an optional peer, a no-op without it.
`@graxia/graphiql` and `@graxia/envelop` are their own packages, installed when used.

## Shutdown

There is no `shutdownSignal` option. Call `graxia.dispose()`: in-flight operations are answered, new
requests get 503 `SHUTTING_DOWN`, SSE streams `complete`, sockets close with 1001. One line wires a
signal to it:

```ts
process.on('SIGTERM', () => graxia.dispose({ timeout: 10_000 }));
```

`dispose()` stops only the servers `graxia.serve()` started; a host that owns `Bun.serve` stops it
itself afterwards (`await server.stop()`). The example's `stop()` also turns its readiness route to
503 first.

## graphql 17

graphql 16 is not supported: the peer is `graphql ^17.1.0`, and `@defer` / `@stream` use graphql
17's incremental delivery (`incremental: { format: 'legacy' }` still sends the 2022-08 payloads to
older clients). Upgrade `graphql` first, and any package that still pins 16.

## Parity with @alxia/graphql 0.16.4

The 33 behaviours checked by the parity suite, each proved by a spec. The table is code,
[`src/parity/checklist.ts`](https://github.com/softistx/graxia/blob/develop/packages/core/src/parity/checklist.ts),
and `checklist.test.ts` fails when a referenced spec or test title disappears or a difference has
no section above. `same` means the behaviour is kept; the others link to their section.

| #   | Item                                                                                        | graxia                                                                 |
| --- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 1   | Host fetch, any path or prefix                                                              | same                                                                   |
| 2   | Typed host context, context factory, compile check                                          | same                                                                   |
| 3   | Resolvers set headers and cookies                                                           | differs: [Setting a header or a cookie](#setting-a-header-or-a-cookie) |
| 4   | 15 000 tokens, 1 000 nesting, stack overflow                                                | same                                                                   |
| 5   | Weighted parse cache and validation cache                                                   | same                                                                   |
| 6   | 1 MiB body limit, 413 keeps plugin headers                                                  | same                                                                   |
| 7   | 415 on a non-JSON body                                                                      | same                                                                   |
| 8   | CSRF custom headers                                                                         | same                                                                   |
| 9   | SameOrigin with its full semantics                                                          | same                                                                   |
| 10  | Persisted operations: strict, sha256, custom key, codes                                     | same                                                                   |
| 11  | Depth limit                                                                                 | same                                                                   |
| 12  | Introspection off outside development                                                       | same                                                                   |
| 13  | Error masking, originalError stripped                                                       | same                                                                   |
| 14  | Batching off, or with a limit                                                               | same                                                                   |
| 15  | SSE over GET and POST, 12 s keep-alive                                                      | same                                                                   |
| 16  | Multipart incremental delivery                                                              | same                                                                   |
| 17  | Streams ended on shutdown                                                                   | same                                                                   |
| 18  | WebSocket on the same path through the host upgrade, params, keep-alive or off, 1001, drain | same                                                                   |
| 19  | Per-operation reporting over HTTP, batch and WebSocket                                      | differs: [Reporting operations](#reporting-operations)                 |
| 20  | Request id never trusted, quiet logs                                                        | differs: [Request id and logs](#request-id-and-logs)                   |
| 21  | GraphiQL development only, Sandbox, CSP                                                     | differs: [Explorer](#explorer)                                         |
| 22  | FieldRateLimit in full                                                                      | same                                                                   |
| 23  | In-process executor with a signal                                                           | same                                                                   |
| 24  | Test client                                                                                 | same                                                                   |
| 25  | CORS left to the host                                                                       | differs: [CORS](#cors)                                                 |
| 26  | Envelop plugins through an adapter                                                          | same                                                                   |
| 27  | Multipart uploads                                                                           | same                                                                   |
| 28  | One stable context per operation                                                            | same                                                                   |
| 29  | Abort signal reaches subscription resolvers                                                 | same                                                                   |
| 30  | Configurable WebSocket message limit                                                        | same                                                                   |
| 31  | Actionable missing-peer errors                                                              | differs: [Peers](#peers)                                               |
| 32  | Host shutdown signal                                                                        | differs: [Shutdown](#shutdown)                                         |
| 33  | Graphql 16 dropped                                                                          | differs: [graphql 17](#graphql-17)                                     |
