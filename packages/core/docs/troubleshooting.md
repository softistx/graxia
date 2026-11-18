# Troubleshooting

The errors a consumer can hit, headed by the message as it appears.

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

## getContext() called outside a graxia operation, or the instance was created with asyncContext: false

`getContext()` only works inside an operation (a resolver, or code one calls) and when `asyncContext`
is not `false`. Call it from a resolver, leave `asyncContext` on, or read the resolver's context
argument. See [Context](./guide/context.md).

## Invalid type definitions: …

The SDL passed to `createSchema` does not parse or build; graphql's message follows. Fix the SDL.

## Invalid schema: …

The SDL builds but the schema is not valid (for example a type with no fields); graphql's message
follows.

## Resolver Query.foo is defined more than once

Two resolver maps given to `createSchema` define the same field. Keep it in one map, or remove the
duplicate. (`Resolvers for X are defined more than once` is the same mistake for a non-object type.)

## Resolvers for X are defined but the schema has no type X

## Resolver Query.foo is defined but Query has no field foo

A resolver names a type or a field that the SDL does not declare, often a typo or a renamed field.
Add it to the SDL or remove the resolver. See [Schema](./guide/schema.md).

## Document contains more than N tokens. Parsing aborted.

The query is larger than `limits.tokens` (15 000 by default). The error has `extensions.code:
"GRAPHQL_PARSE_FAILED"`, `limit` and `fix`. Split the operation, or raise the limit:

```ts
createGraxia({ schema, limits: { tokens: 30_000 } });
```

## Document is nested more than N levels deep. Parsing aborted.

The query nests deeper than `limits.nesting` (1 000 by default). Same code and `fix`; flatten the
document or raise `limits.nesting`. See [Limits and caches](./guide/limits-and-caches.md).

## Document is nested too deeply to parse.

A document under `limits.nesting` still overflowed the parser's stack (`nesting: false` or a
very high limit make it likely). It is a `GRAPHQL_PARSE_FAILED` error with a `fix`, never
`Unexpected error.`, and is not cached. Flatten the document, or lower `limits.nesting`.

## Cannot query field "x" on type "Query".  (`GRAPHQL_VALIDATION_FAILED`)

The document parsed but does not validate against the schema. Every such error carries
`extensions.code: "GRAPHQL_VALIDATION_FAILED"`, with `locations`. Fix the query, or the schema.

## limits.bodyBytes must be a positive integer

`limits.bodyBytes` is not an integer of at least 1. Pass a byte count, such as `1_048_576`.

## batching.limit must be a positive integer

`batching: { limit }` needs an integer of at least 1.

## Subscriptions are served over server-sent events: send "Accept: text/event-stream".

A subscription arrived without an `Accept` that prefers `text/event-stream` (`SUBSCRIPTION_NOT_SUPPORTED`).
Request the stream (a `graphql-sse` client does), or call it over GET with that header:

```ts
await fetch('http://localhost:3000/graphql', {
	method: 'POST',
	headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
	body: JSON.stringify({ query: 'subscription { tick }' }),
});
```

`graxia.execute` and the test client never run subscriptions, so they always get this refusal.

## Subscriptions are not supported over this transport (subscriptions.sse is false).

`createGraxia({ subscriptions: { sse: false } })` turns the event stream off. Remove the option (it is
`true` by default).

## subscriptions.keepAliveMs must be a finite number above 0 (milliseconds)

Pass a count of milliseconds such as `12_000`.

## Batched operations cannot be sent over text/event-stream.

A JSON array body came with an `Accept` that prefers `text/event-stream`. Send one operation per
request, or ask for `application/json`.

## Streams may be cut after `idleTimeout` with my own `Bun.serve`

`Bun.serve` may close a silent connection after `idleTimeout` seconds (10 by default). `graxia.serve()`
calls `server.timeout(request, 0)` for each stream as a precautionary safeguard (a 1 s `idleTimeout`
probe did not cut the stream on Bun 1.4.4, but other versions may). With your own server, pass it
(see [Bun idle timeout](./guide/subscriptions.md#bun-idle-timeout)):

```ts
Bun.serve({ fetch: (request, server) => graxia.fetch(request, { server }) });
```

Keep `subscriptions.keepAliveMs` below the idle timeout of any proxy in front of the server.

## path must start with "/" (or be false)

`path` is a URL path such as `/graphql`, or `false` to serve any path.

## shutdownTimeout must be a non-negative integer (milliseconds)

Pass a count of milliseconds (`0` aborts at once), such as `10_000`.

## Resolver Color.PURPLE is defined but enum Color has no value PURPLE

An enum resolver map names a value the SDL does not declare. Fix the name or add the value to the SDL.

## Resolver Pet.name is defined but a union has no fields; only __resolveType is allowed

A union has no fields: give it only `__resolveType`, and put field resolvers on its member types.

## A response cannot have status N

A plugin answered with a response whose status is outside 200 to 599 (`Response.error()` has status 0).
The client gets the generic 500 instead. Answer with a real HTTP status.

## A custom scalar's message reaches the client

graphql reports a `parseValue` that throws a plain `Error` as a coercion error, unmasked. Throw
`exposedError('BAD_USER_INPUT', …)` or a `GraphQLError` with a safe message. See
[Errors](./guide/errors.md#known-behaviour-scalar-coercion).

## graxia.execute: the request ended with an HTTP N response instead of a result; see error.response.

`graxia.execute` rejects with a `GraxiaExecuteError` when the pipeline answered with something other
than an execution result: a plugin returned `respond(...)` (for example a 401 from an auth plugin),
a hook failed unexpectedly (500), or the instance was disposed (503). The HTTP answer is on
`error.response` (and `error.status`):

```ts
try {
	await graxia.execute({ document: '{ me { id } }' });
} catch (error) {
	if (error instanceof GraxiaExecuteError)
		console.log(error.status, await error.response.text());
}
```

Pass the headers the plugin expects (`headers: { authorization: … }`). See
[Testing](./guide/testing.md).

## Server is shutting down.

`graxia.execute` rejects with this `GraxiaExecuteError` (status 503, `SHUTTING_DOWN`) once `dispose()`
has started, as `fetch` answers 503. Stop sending work after `dispose()`; see
[Context, cancellation and shutdown](./guide/context.md).

## graxia.execute: variables must be JSON-serializable (no BigInt, no cycles)

`execute` throws this `TypeError` because `variables` travel as JSON, like over HTTP. Remove `BigInt`s and cycles, or convert them (a `BigInt`
to a string) before calling `execute`.

## Resolvers for X are defined more than once

Two resolver maps given to `createSchema` define a non-object type (a scalar or an enum, say) under
the same name. Keep one definition. For object types the message names the field instead
(`Resolver Query.foo is defined more than once`).

## Resolvers for X must be an object

The resolvers of an object, interface, union or enum type must be a plain object of fields (or
values). A function, string or array was given:

```ts
resolvers: {
	Query: {
		hello: () => 'hi';
	}
} // not `Query: () => 'hi'`
```

## Resolvers for X are defined but X is an input type

Input types have no resolvers. Remove the entry; defaults and validation belong in the SDL.

## Resolvers for X is a GraphQLScalarType but X is not a scalar

A `GraphQLScalarType` was given under the name of a type that the SDL declares as something else.
Declare `scalar X` in the SDL, or move the entry to the right name.

## Resolvers for scalar X must be a GraphQLScalarType

A scalar's entry is a graphql `GraphQLScalarType` (`new GraphQLScalarType({ name, parseValue, ... })`),
not a plain object or function.

## Resolvers for scalar X is a GraphQLScalarType named Y; the names must match

The `name` of the `GraphQLScalarType` differs from the key it sits under. Make them equal.

## Resolver X.y is not valid on an object type

## Resolver X.y is not valid on an interface type

A key starting with `__` that this kind of type does not take: `__isTypeOf` is for object types and
`__resolveType` for interfaces and unions. Move it to the right type, or rename the field (names
starting with `__` are reserved by GraphQL).

## Resolver X.y must be a function or { resolve, subscribe }

A field's resolver is a function, or an object with `resolve` and/or `subscribe` functions. Anything
else (a value, `null`) is refused. For a constant, write `() => value`.

## persisted: true needs a document; pass { sha256Hash } to send a hash alone

Thrown by the `@graxia/core/testing` client: `persisted: true` computes the hash from the document,
so the document cannot be `null`.

```ts
await client.query('{ hello }', { persisted: true }); // sends the hash and the text
await client.query(null, { persisted: { sha256Hash: 'ecf4…' } }); // sends the hash alone
```

## A null document needs persisted: { sha256Hash }

The test client was given `null` as the document without a hash to send. Pass
`{ persisted: { sha256Hash } }`, or a document.

## Expected no GraphQL errors, got N:

`expectNoErrors(result)` found errors in the result. Each following line is
`- message [CODE] at path`; fix the cause (a masked error shows `Unexpected error.` and its
correlation id, which `onUnexpected` matches to the original). To assert an error on purpose, check
`result.errors` yourself.

## dispose: N operation(s) did not settle after abort

Reported to `onUnexpected` with `phase: "dispose"`: `graxia.dispose()` aborted the in-flight
operations and waited `shutdownTimeout`, but some resolvers did not return. They ignore the
context's `signal`. Pass it on to what they call (`fetch(url, { signal })`, a database driver's
cancel option), or raise `shutdownTimeout`. See [Context](./guide/context.md).
