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

## Operation depth N exceeds the limit of M.

The operation selects fields nested deeper than `limits.depth` (12 by default), fragments
expanded. A `GRAPHQL_VALIDATION_FAILED` error (HTTP 400) with `extensions.limit`
(`{ name: 'depth', max, actual }`) and `fix`. Ask for fewer nested fields, or raise it:

```ts
createGraxia({ schema, limits: { depth: 16 } }); // or false
```

## Operation has N aliases, over the limit of M.

More aliased fields than `limits.aliases` (30). Use fewer aliases or raise `limits.aliases`.
`extensions.limit.name` is `aliases`.

## Operation has N directives, over the limit of M.

More directive usages than `limits.directives` (50). `extensions.limit.name` is `directives`.

## Operation has N root fields, over the limit of M.

More root fields than `limits.rootFields` (20), `__typename` excluded. Split the operation
or raise it. `extensions.limit.name` is `rootFields`.

## Operation cost N exceeds the limit of M.

The cost of the operation is over `limits.cost.max` (5 000). The cost multiplies list fields
by their size: a slicing argument (`first: 100`), `assumedSize` or `limits.cost.defaultListSize`.
Request fewer items, give the field `@listSize(slicingArguments: ["first"])`, or raise it. The
check reads variables, so `first: $n` counts. `extensions.limit.name` is `cost`.

```ts
createGraxia({ schema, limits: { cost: { max: 20_000 } } }); // or cost: false
```

## Field Query.users requires one of its slicing arguments (first, last).

A list field declared with `@listSize(slicingArguments: [...])` was asked for without any of them
holding a valid value (absent, `null`, negative, not an integer, or an unprovided variable).
Pass one, or set `requireOneSlicingArgument: false` on the `@listSize` to fall back to
`assumedSize` / `limits.cost.defaultListSize`. `extensions.limit.name` is `cost`.

## limits.depth must be a positive integer (or false)

`limits.depth` is not an integer of at least 1. Pass one, or `false`.

## limits.aliases must be a positive integer (or false)

Same for `limits.aliases`.

## limits.directives must be a positive integer (or false)

Same for `limits.directives`.

## limits.rootFields must be a positive integer (or false)

Same for `limits.rootFields`.

## limits.cost must be false or an object ({ max, defaultListSize, objectCost, scalarCost })

`limits.cost` is neither `false` nor an object. Pass `false`, or the settings you want:

```ts
createGraxia({ schema, limits: { cost: { max: 10_000 } } });
```

## limits.cost.max must be a positive integer

Also `limits.cost.defaultListSize must be a positive integer`.

## limits.cost.objectCost must be a non-negative integer

Also `limits.cost.scalarCost must be a non-negative integer`.

## Cannot query field "x" on type "Query".  (`GRAPHQL_VALIDATION_FAILED`)

The document parsed but does not validate against the schema. Every such error carries
`extensions.code: "GRAPHQL_VALIDATION_FAILED"`, with `locations`. Fix the query, or the schema.

## limits.bodyBytes must be a positive integer

`limits.bodyBytes` is not an integer of at least 1. Pass a byte count, such as `1_048_576`.

## batching.limit must be a positive integer

`batching: { limit }` needs an integer of at least 1.

## Subscriptions are served over server-sent events (send "Accept: text/event-stream") or WebSocket (graphql-transport-ws).

A subscription arrived as plain JSON while both transports are on (`SUBSCRIPTION_NOT_SUPPORTED`).
Request the event stream (a `graphql-sse` client does), or use a `graphql-transport-ws` client:

```ts
await fetch('http://localhost:3000/graphql', {
	method: 'POST',
	headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
	body: JSON.stringify({ query: 'subscription { tick }' }),
});
```

`graxia.execute` and the test client never run subscriptions, so they always get this refusal.

## Subscriptions are served over server-sent events: send "Accept: text/event-stream".

The same refusal when `subscriptions.ws` is `false`: only the event stream is on. Send the `Accept` header as above.

## Subscriptions are served over WebSocket (graphql-transport-ws); subscriptions.sse is false.

The same refusal when `subscriptions.sse` is `false` and WebSocket is on: use a `graphql-transport-ws` client
(see [WebSocket](./guide/websocket.md)), or remove `sse: false`.

## Subscriptions are not supported over this transport (subscriptions.sse is false).

Both `subscriptions: { sse: false, ws: false }` are set, so no transport serves a subscription. Remove one
(each is on by default).

## subscriptions.sse.keepAliveMs must be an integer from 0 to 2147483647 (milliseconds, 0 turns keep-alive comments off)

Pass `12_000`, or `0` to stop the keep-alive comments. The most is `2_147_483_647` (the largest timer delay).

## subscriptions.ws.connectionInitWaitTimeout must be a positive integer (milliseconds)

Pass a count of milliseconds such as `3_000`. The default is `3_000`.

## subscriptions.ws.keepAliveMs must be an integer from 0 to 2147483647 (milliseconds, 0 turns pings off)

Pass `12_000`, or `0` to stop the server's `ping` messages. The most is `2_147_483_647` (the largest timer delay).

## subscriptions.ws.maxPayloadBytes must be a positive integer (bytes)

Pass a byte count such as `1_048_576` (the default).

## Unauthorized

Close code **4401**. `subscribe` came before `connection_ack`. Wait for the client's `connected`
event (`graphql-ws` does). See the [close codes](./guide/websocket.md#close-codes).

## Forbidden

Close code **4403**. `onConnect` returned `false` or threw an `exposedError`. Check the
`connectionParams` the client sent.

## Connection initialisation timeout

Close code **4408**. No `connection_init` within `connectionInitWaitTimeout` (3 s). A hand-made client
must send it first.

## Subscriber for <id> already exists

Close code **4409**. `subscribe` reused the id of an active operation. Ids are free again after
`complete`.

## Too many initialisation requests

Close code **4429**. `connection_init` was sent twice on one socket.

## Invalid message received

Close code **4400**. A frame was not valid JSON, or not an object with a string `type`. Use the
`graphql-ws` client, or send `{ "type": ..., "id"?: ..., "payload"?: ... }` as JSON text.

## Unknown message type "x"

Close code **4400**. The `type` is none of `connection_init`, `ping`, `pong`, `subscribe`,
`complete`.

## Invalid "<type>" message: …

Close code **4400**. The text after the colon says what is wrong: a payload that is not an object, a
`subscribe` or `complete` without a non-empty string `id`, or a `subscribe` payload that is not
`{ query, variables?, operationName?, extensions? }`.

## Binary messages are not supported

Close code **4400**. Send text frames only.

## Internal error

Close code **1011**. `onConnect` or the socket handler threw an unexpected error; it reached
`onUnexpected` with the request id. Other codes you may see: **1001** `Going away` (the server is
shutting down, `dispose()`; reconnect elsewhere) and **1009** (a message was larger than
`subscriptions.ws.maxPayloadBytes`, Bun's own close).

## The operation was refused.

An `error` message with this text answers a `subscribe` whose operation a plugin ended with its own
`Response` from `onRequest` or `onParams` (an auth refusal, a cache hit): a socket has no HTTP response to
carry it. Refuse the connection instead, in `subscriptions.ws.onConnect` (return `false`, close code 4403), or answer in
`onRequest` on the upgrade request, which refuses the handshake with that `Response`.

## The operation failed.

An `error` message with this text answers a `subscribe` whose parse or validation errors an
`onResultChunk` hook removed: graphql-transport-ws requires at least one error in an `error` message,
so graxia sends this generic one. Let the hook keep (or rewrite) the errors instead of dropping them.

## WebSocket is disabled

Close code **1008**. A socket reached graxia's handler while `subscriptions.ws` is `false`. Your own
`Bun.serve` upgraded it without checking `graxia.isUpgrade(request)`; guard the upgrade with it.

## The WebSocket handshake fails with a 400, 404 or 405

The upgrade must be a `GET` to the served `path` and offer the `graphql-transport-ws` subprotocol:
`new WebSocket(url, 'graphql-transport-ws')`.

- `Not found.` (404): the path is not graxia's `path`.
- `A WebSocket upgrade must be a GET request.` (405, `Allow: GET`).
- `The Sec-WebSocket-Protocol header must offer "graphql-transport-ws".` (400): no such subprotocol.
- `The WebSocket upgrade failed.` (400): Bun refused the upgrade, e.g. missing `Sec-WebSocket-Key`.

With `subscriptions: { ws: false }` the request is handled as plain HTTP.

## Batched operations cannot be sent over text/event-stream.

A JSON array body came with an `Accept` that prefers `text/event-stream`. Send one operation per
request, or ask for `application/json`.

## Incremental delivery (@defer, @stream) needs "Accept: multipart/mixed" or "Accept: text/event-stream".

A query with `@defer` or `@stream` came with a JSON `Accept` (or none): a single JSON body cannot carry
the later payloads. The error has `extensions.code: "INCREMENTAL_NOT_SUPPORTED"`. Send
`Accept: multipart/mixed;deferSpec=20220824, application/json` (Apollo Client does) or
`Accept: text/event-stream`. `graxia.execute` and the test client always answer it: use `fetch`.

## Incremental delivery (@defer, @stream) is disabled (incremental is false).

The instance was created with `incremental: false`. Remove the option (or pass `true`), or drop
`@defer` / `@stream` from the query.

## incremental.format must be "graphql17" or "legacy"

`createGraxia({ incremental: { format } })` got another value. `graphql17` is the default; `legacy`
is the 2022-08 format older clients read.

## The provided schema unexpectedly contains experimental directives (@defer or @stream). These directives may only be utilized if experimental execution features are explicitly enabled.

Graphql's plain `execute` was given a schema from `createSchema`, which declares `@defer` and
`@stream`. Run the schema through graxia or `experimentalExecuteIncrementally`, or build it with
`createSchema()({ typeDefs, resolvers, incremental: false })`.

## Incremental delivery (@defer, @stream) is not supported over this transport yet.

A subscription event used `@defer` or `@stream`; incremental delivery inside subscription events is not
supported. Code `INCREMENTAL_NOT_SUPPORTED`. Remove the directive from the subscription's selection.

## Unknown directive "@defer".

The schema is a `GraphQLSchema` you built without the directives (`createSchema` adds them). Add
`GraphQLDeferDirective` and `GraphQLStreamDirective` next to `specifiedDirectives`; see
[`@defer` and `@stream`](./guide/incremental.md).

## Batched operations cannot be sent over multipart/mixed.

A JSON array body came with an `Accept` that prefers `multipart/mixed`. Send one operation per
request, or ask for `application/json`.

## Streams may be cut after `idleTimeout` with my own `Bun.serve`

`Bun.serve` may close a silent connection after `idleTimeout` seconds (10 by default). `graxia.serve()`
calls `server.timeout(request, 0)` for each stream as a precautionary safeguard (a 1 s `idleTimeout`
probe did not cut the stream on Bun 1.4.4, but other versions may). With your own server, pass it
(see [Bun idle timeout](./guide/subscriptions.md#bun-idle-timeout)):

```ts
Bun.serve({ fetch: (request, server) => graxia.fetch(request, { server }) });
```

Keep `subscriptions.sse.keepAliveMs` below the idle timeout of any proxy in front of the server.

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

## This request requires one of the headers x-graphql-csrf, graphql-require-preflight, apollo-require-preflight, x-apollo-operation-name (CSRF prevention).

The server answered 403 `CSRF_HEADER_REQUIRED`. The request is one a browser can send cross-site
without a CORS preflight (a `GET`, or a `POST` with no `Content-Type` or a `text/plain`,
`application/x-www-form-urlencoded` or `multipart/form-data` one) and carries none of the listed
headers. Send a JSON `POST`, or add a header with any non-empty value; a client library has a
setting for it (see [Security](./guide/security.md)).

```ts
await fetch(url, {
	method: 'POST',
	headers: { 'content-type': 'application/json', 'x-graphql-csrf': '1' },
	body: JSON.stringify({ query: '{ hello }' }),
});
```

A server no browser can reach may turn the check off with `csrf: { requireHeader: false }`. With a
custom `requireHeader` list the message names your headers instead.

## Cross-origin request refused from <origin>.

403 `FORBIDDEN_ORIGIN`. Either `csrf.sameOrigin` is on and the request's `Origin` is not the
server's own origin or in `allowedOrigins`, or a WebSocket upgrade came from such an origin (this
check is on even with `sameOrigin` off). The origin is compared with the request URL graxia sees,
so behind a proxy pass the public URL, or list the public origin. The message ends with
`from a null origin.` for `Origin: null` (a sandboxed frame, a `file:` page; always refused) and
`from an unknown origin.` for a browser request marked `Sec-Fetch-Site: cross-site` with no `Origin`.

```ts
createGraxia({
	schema,
	csrf: { sameOrigin: { allowedOrigins: ['https://app.example.com'] } },
});
```

## GraphQL introspection is not allowed, but the query contained __schema or __type.

`GRAPHQL_VALIDATION_FAILED` with a `fix`: `introspection` is `false`, or `NODE_ENV` is `production`
and you did not set it. Set `introspection: true` to allow it (a code generator or an explorer
needs it); `__typename` is always allowed.

## csrf must be false or an object ({ requireHeader, sameOrigin })

`createGraxia` throws a `GraxiaConfigError`. Pass `csrf: false` or an object, not `true`.

## csrf.requireHeader must be a boolean or a non-empty list of header names

`requireHeader` is `true`, `false` or a non-empty array of valid header names (no spaces).

## csrf.sameOrigin must be a boolean or an object ({ allowedOrigins, crossOrigin })

Pass `sameOrigin: true`, `false` or `{ allowedOrigins, crossOrigin }`.

## csrf.sameOrigin.crossOrigin must be "refuse", "json" or "allow"

Pick one of the three modes (see [Security](./guide/security.md)).

## csrf.sameOrigin.allowedOrigins must be a list of origins (e.g. "https://app.example.com")

`allowedOrigins` is an array of strings.

## csrf.sameOrigin.allowedOrigins entry "x" is not an origin (use scheme, host and optional port, no path: "https://app.example.com")

An entry must be exactly `scheme://host[:port]`: no path, no trailing slash, not `null`.

## introspection must be a boolean

## suggestions must be a boolean

Both options take `true` or `false`; leave them out to follow `NODE_ENV`.
