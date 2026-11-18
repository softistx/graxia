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

The plugin's `setup` threw; the original error is the `cause` and its message follows. Fix the cause
(a missing peer, a bad option). The instance cannot serve until every `setup` ran.

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

## limits.bodyBytes must be a positive integer

`limits.bodyBytes` is not an integer of at least 1. Pass a byte count, such as `1_048_576`.

## batching.limit must be a positive integer

`batching: { limit }` needs an integer of at least 1.

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

## graxia.execute: the request ended with an HTTP N response instead of a result

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
