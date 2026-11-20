# Troubleshooting: HTTP, execute and testing

Server, `graxia.execute`, testing client and shutdown errors, headed by the message as it appears. The rest is in [Troubleshooting](./troubleshooting.md).

## path must start with "/" (or be false)

`path` is a URL path such as `/graphql`, or `false` to serve any path.

## shutdownTimeout must be a non-negative integer (milliseconds)

Pass a count of milliseconds (`0` aborts at once), such as `10_000`.

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

## Variable "$id" has invalid value: … (`BAD_USER_INPUT`)

Also `Unknown operation named "X".` and
`Must provide operation name if query contains multiple operations.`: the request was refused
before any field ran. Send the variables the operation declares, with their types, and an
`operationName` the document holds. `extensions.fix` says the same.

## graxia.execute: variables must be JSON-serializable (no BigInt, no cycles)

`execute` throws this `TypeError` because `variables` travel as JSON, like over HTTP. Remove `BigInt`s and cycles, or convert them (a `BigInt`
to a string) before calling `execute`.

## persisted: true needs a document; pass { sha256Hash } to send a hash alone

Thrown by the `@graxia/core/testing` client: `persisted: true` computes the hash from the document,
so the document cannot be `null`.

```ts
await client.query('{ hello }', { persisted: true }); // sends the hash and the text
await client.query(null, { persisted: { sha256Hash: 'ecf4…' } }); // sends the hash alone
```

## A null document needs persisted: { sha256Hash } or documentId

The test client was given `null` as the document without a hash or an id to send. Pass
`{ persisted: { sha256Hash } }`, `{ documentId }`, or a document.

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
