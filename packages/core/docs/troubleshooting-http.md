# Troubleshooting: HTTP, execute and testing

Server, `graxia.execute`, testing client and shutdown errors, headed by the message as it appears. The rest is in [Troubleshooting](./troubleshooting.md).

## path must start with "/" (or be false)

`path` is a URL path such as `/graphql`, or `false` to serve any path.

## errorHttp must be true or false

`errorHttp` turns the reading of `extensions.http` on errors on (`true`, the default) or off (`false`).
Pass a boolean: `createGraxia({ schema, errorHttp: false })`.

## A GraphQL error has `extensions.http` but the response is 200

The status is read only when `errorHttp` is not `false`, from a single operation answered as plain JSON, from an integer between 200 and 599, and under
`application/json` not when the error's `extensions.http.spec` is `true`. A batch, a WebSocket and a multipart answer ignore it, and so does an SSE query or a subscription that fails after its first event (a subscription refused before its stream opens does honour it, on its event-stream response; there `spec: true` drops the status whatever `Accept` says); and so does a
plugin refusal's status (it wins). A masked unexpected error (a plain `Error`) carries no `http`: throw an `exposedError`
or a `GraphQLError`, or have `maskError` keep it. See [Errors](./guide/errors.md#status-and-headers-from-errors).

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

Thrown by the `@softistx/graxia/testing` client: `persisted: true` computes the hash from the document,
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

## The request body is too large. (`BODY_TOO_LARGE`)

413. The body is over `limits.bodyBytes` (1 MiB by default), counted as it streams. Send a smaller body, or raise the limit: `createGraxia({ schema, limits: { bodyBytes: 4 << 20 } })`. Multipart bodies have their own limit, `uploads.bodyBytes` (`UPLOAD_TOO_LARGE`).

## The Content-Type must be application/json (UTF-8). (`UNSUPPORTED_MEDIA_TYPE`)

415. A POST body is read as JSON only. Send `Content-Type: application/json` (a charset, if any, must be UTF-8).

## The request body could not be read. / The request body is not valid UTF-8. (`BODY_UNREADABLE`)

400. The stream failed (the client aborted) or the bytes are not UTF-8. Re-send the body encoded as UTF-8.

## The request body is not valid JSON. (`BODY_NOT_JSON`)

400. The body does not parse. Send `{ "query": "..." }`.

## Must provide a query string. (`QUERY_REQUIRED`)

400. The request has no `query` string (an empty one counts), and no `documentId` that resolves to one. Send `{ "query": "..." }`, or a `documentId` when trusted documents are on.

## Not found. (`PATH_NOT_FOUND`)

404. The request is not on graxia's `path` (`/graphql` by default). Send it to that path, or set `path`, or `path: false` to serve any path.

## Only GET and POST are allowed. (`METHOD_NOT_ALLOWED`)

405, with `Allow: GET, POST`. Use GET for queries or POST for any operation. A mutation over GET answers `Can only perform a mutation operation from a POST request.` (405, `Allow: POST`) with the same code.

## The Accept header must allow application/graphql-response+json or application/json. (`NOT_ACCEPTABLE`)

406. Send `Accept: application/graphql-response+json` or `application/json` (a missing header or `*/*` is fine).

## Batching is not enabled on this server. (`BATCHING_DISABLED`)

400. A JSON array body arrived while `batching` is off (the default). Send one operation, or set `batching: true` (up to 10) or `{ limit }`.

## A batch holds at most N operations, got M. (`BATCH_TOO_LARGE`)

400. Send fewer operations per request, or raise `batching.limit`.

## A batch must hold at least one operation. (`BATCH_INVALID`)

400. The array is empty, or an entry is not a valid operation (`Batch entry N: …` names it).

## Telling refusals apart

Every request-level refusal (413, 415, 400, 404, 405, 406) has a stable `extensions.code`: see
[Refusal codes](./guide/http.md#refusal-codes). Match on the code, not on the message.
