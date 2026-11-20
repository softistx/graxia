# Troubleshooting

The errors a consumer can hit, headed by the message as it appears.

## Unknown directive "@needs" (or "@constraint", "@errors")

`createSchema` or `buildSchema` refuses the SDL because the agent directives are not declared. Add
`agentTypeDefs` from `@graxia/core/agent` to `typeDefs`, or pass `agentDirectives` to a schema
built in code.

```ts
createSchema()({ typeDefs: [agentTypeDefs, sdl], resolvers });
```

## Duplicate `@constraint` directive, or "There can be only one directive named "@constraint""

`agentTypeDefs` defines `@constraint`, and so does `graphql-constraint-directive` (or another library) if
you also use it: the schema then has two definitions of the same directive. graxia's `@constraint` only
describes limits for agents (it enforces nothing) and its arguments are a superset of the common ones
(`minLength`, `maxLength`, `min`, `max`, `exclusiveMin`, `exclusiveMax`, `multipleOf`, `minItems`, `maxItems`,
`pattern`, `format`). Keep one definition: leave `agentTypeDefs` out and declare the directive yourself with
the arguments you use, or remove the other library's definition. `printSchemaFor` declares only the agent
directives it prints, so it adds a second definition to a schema that already has one: print from a schema
that has the library's directive removed.

## `printSchemaFor` output does not build: "Unknown directive" or "Type X not found"

`buildSchema(printSchemaFor(schema))` fails when the schema uses a directive or type that the printer does not
write: only the agent directives (`@needs`, `@constraint`, `@errors`), `@deprecated`, `@specifiedBy` and `@oneOf`
are printed. Other applied directives (your own, `@cost`, `@listSize`) are left out, and a type reachable only
through them is dropped. Build the visible schema with `visibleSchema(schema, { can })`, which is always
valid, and validate against it. Pass a permission check that names every permission your `@needs` use: a
typo in a permission hides the field for every caller.

## `@needs` gives both `permission` and `anyOf`, or neither

`lintDescriptions` reports `invalid-needs`, and the field stays hidden from every caller (it fails closed).
Give exactly one: `@needs(permission: "books:write")` or `@needs(anyOf: ["books:write", "books:admin"])`.
Repeat `@needs` to require several (AND).

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

## Property ''createSchema<Ctx>: these resolvers expect another context (see expected)'' is missing

A type error on `resolvers`: the resolver map (typically graphql-codegen's `Resolvers<X>`) was built
for a context `X` that `createSchema<Ctx, …>()`'s `Ctx` does not provide. The message shows
`expected` (what the resolvers need) and `actual` (your `Ctx`). Point codegen's `contextType` at
the same `InferContext` type you pass to `createSchema`, regenerate, and see [Codegen](./guide/codegen.md).

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

## The schema declares @cost(…) but graxia's limits.cost reads @cost(weight: Int!)

Your schema declares `@cost` or `@listSize` with another shape than graxia's (for example the IBM
form `directive @cost(weight: String!) on FIELD_DEFINITION`). The cost limit reads those directives
with its own definitions and would fail on every operation, so `createGraxia` throws a
`GraxiaConfigError`: `The schema declares @cost(<your arguments, with defaults>) but graxia's limits.cost reads @cost(weight: Int!). Rename or drop your directive, …`. The same message exists for `@listSize` (graxia reads `@listSize(assumedSize: Int, requireOneSlicingArgument: Boolean = true, sizedFields: [String!], slicingArguments: [String!])`); a different argument name, type or default value is a clash. Rename or drop your directive, or turn the
cost limit off:

```ts
createGraxia({ schema, limits: { cost: false } });
```

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

## uploads.bodyBytes must be a positive integer

`uploads.bodyBytes`, `uploads.fileBytes` or `uploads.files` is not an integer of at least 1 (message
`uploads.fileBytes must be a positive integer no larger than uploads.bodyBytes` when the file limit is
above the body limit). Pass byte counts such as `uploads: { bodyBytes: 16 << 20, fileBytes: 8 << 20 }`.

## uploads need CSRF prevention: a browser can post multipart/form-data cross-site without a preflight.

`createGraxia` refuses `uploads` together with `csrf: false` or `csrf: { requireHeader: false }`: a browser
can post `multipart/form-data` cross-site without a preflight. Keep `csrf.requireHeader` on (the default),
or turn uploads off.

```ts
createGraxia({ schema, uploads: true }); // CSRF header required (default)
```

## File uploads (multipart/form-data) are not enabled on this server.

415 `UPLOADS_NOT_ENABLED`: a multipart body reached a server without `uploads`. Send JSON, or enable it:
`createGraxia({ uploads: true })`.

## The request body is larger than uploads.bodyBytes (N bytes).

413 `UPLOAD_TOO_LARGE`. The whole multipart body is over `uploads.bodyBytes` (16 MiB by default). Send less, or
raise it. The same code answers `File "0" is larger than uploads.fileBytes (N bytes).` (one file) and
`The "operations" field is larger than limits.bodyBytes (N bytes).` (the JSON part; raise `limits.bodyBytes`).

## The request holds N files; uploads.files allows M.

413 `UPLOAD_TOO_MANY_FILES`. Send fewer files per request or raise `uploads.files`.

## The multipart body could not be parsed. (and the other `UPLOAD_INVALID` messages)

400 `UPLOAD_INVALID`: the request breaks the GraphQL multipart request spec. Send `operations` (JSON), then
`map` (file field name → paths such as `variables.file`), then one part per file. The messages:

- `The multipart body could not be parsed.`: a missing or wrong boundary, or a truncated body.
- `The multipart request has no "operations" field.` / `no "map" field.`
- `The "operations" field is not valid JSON.`
- `The "map" field must be a JSON object of file field names to arrays of paths.`
- `Map entry "0" points at "query"; a file may only go under "variables".`
- `Map entry "0" points at "variables.f", which is not null in "operations".`: the slot must be `null` in `operations`.
- `Map entry "0" path "variables.__proto__" is not allowed.`
- `Map entry "0" has no file part.` / `File part "1" is not in "map".`

## File must be sent as a file part of a multipart request (GraphQL multipart request spec).

`GraphQLFile` refused a value that is not a `File`: a JSON request sent a string for a `File` argument, or
a literal was written in the document. Send the file as a multipart part.

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

## Incremental delivery (@defer, @stream) needs "Accept: multipart/mixed", or "text/event-stream" ranked above JSON.

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

## Variable "$id" has invalid value: … (`BAD_USER_INPUT`)

Also `Unknown operation named "X".` and
`Must provide operation name if query contains multiple operations.`: the request was refused
before any field ran. Send the variables the operation declares, with their types, and an
`operationName` the document holds. `extensions.fix` says the same.

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

A plugin's `csrfExempt` that matches a `GET` no plugin answers gets this same 403 on purpose (an
exempt request never executes an operation): make the plugin's `onRequest` answer it with `respond`,
or narrow the predicate. See [Security](./guide/security.md).

A server no browser can reach may turn the check off with `csrf: { requireHeader: false }`. With a
custom `requireHeader` list the message names your headers instead.

## Cross-origin request refused from <origin>.

403 `FORBIDDEN_ORIGIN`. Either `csrf.sameOrigin` is on and the request's `Origin` is not the
server's own origin or in `allowedOrigins`, or a WebSocket upgrade came from such an origin (this
check is on even with `sameOrigin` off). The origin is compared with the request URL graxia sees,
so behind a proxy pass the public URL, or list the public origin. The message ends with
`from a null origin.` for `Origin: null` (a sandboxed frame, a `file:` page; always refused) and
`from an unknown origin.` for a browser request marked `Sec-Fetch-Site: cross-site` or `same-site` with no `Origin`.

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

## Only persisted documents are allowed.

`trustedDocuments` is in `strict` mode (the default when `NODE_ENV=production`) and the request sent
a query in full with no id that resolves. The response is 400 with code `PERSISTED_QUERY_ONLY` and
a `fix`. Send the `documentId` (or APQ hash) from your manifest, or run `mode: 'mixed'` where
arbitrary queries are fine.

## Persisted document <id> not found.

A `documentId` (or an `extractKey` id) is in neither the manifest nor the `store`. Regenerate the
manifest and redeploy the server before the clients that use it. 400, code
`PERSISTED_QUERY_NOT_FOUND`.

## PersistedQueryNotFound

An APQ client sent a hash alone that the server never saw. It is the first step of the protocol:
the client sends the query and the hash again and the server registers it. If it loops, the `store`
loses entries (a short TTL, an eviction) or differs between processes: use `redisCache()`. Code
`PERSISTED_QUERY_NOT_FOUND`.

## PersistedQueryNotSupported

A client sent `extensions.persistedQuery` and the server cannot serve or register it: `apq` is
`false`, or the mode is `strict` and the hash is not in the manifest. Apollo Client then drops the
extension and sends the query, which `strict` refuses with `Only persisted documents are allowed.`
Code `PERSISTED_QUERY_NOT_SUPPORTED`.

## provided sha does not match query

The `sha256Hash` is not the lower-case hex SHA-256 of the `query` sent with it (UTF-8, as sent).
The client hashes a different text from the one it sends (a transform after hashing). Code
`PROVIDED_SHA_DOESNT_MATCH`.

## Unsupported persisted query version

`extensions.persistedQuery.version` is not `1`. Code `PERSISTED_QUERY_VERSION_NOT_SUPPORTED`.

## Send either documentId or query, not both.

A request has a `documentId` (or an id from `extractKey`) and a `query`. Send one. 400.

## The "persistedQuery" extension must be { version: 1, sha256Hash: string }.

`extensions.persistedQuery` is not an object with a string `sha256Hash`. 400.

## The "documentId" parameter must be a string.

The `documentId` of a body or a WebSocket payload is not a string. 400.

## trustedDocuments must be an object ({ manifest, store, apq, mode, extractKey })

The option is not an object. Leave it out to turn trusted documents off.

## trustedDocuments.mode must be "strict" or "mixed"

`mode` is something else (a typo, a boolean). Use `'strict'` or `'mixed'`, or leave it out to follow `NODE_ENV`.

## trustedDocuments.apq must be a boolean

`apq` is not `true` or `false`. Pass a boolean, or leave it out (on in `mixed`, off in `strict`).

## trustedDocuments.store must be a KeyValueCache (get, set and delete)

`store` lacks `get`, `set` or `delete`. Pass `createMemoryCache()` or `redisCache()`, or any object with the three methods.

## trustedDocuments.extractKey must be a function (params, request) => string | undefined

`extractKey` is not a function. Pass `(params, request) => string | undefined`, returning `undefined` when the request names no document.

## trustedDocuments.mode "strict" needs a manifest, or extractKey with a store: no document could ever run

`strict` runs only persisted documents, and none can exist. In production the mode is `strict` by
default, so `trustedDocuments: {}` fails there. Add a `manifest`, or `extractKey` with a `store`, or
set `mode: 'mixed'`.

## trustedDocuments.manifest must be a Map, an object of id to source, or an Apollo persisted query manifest

The manifest is none of the three formats. Pass the parsed JSON of `persisted-queries.json`,
`persisted-documents.json` or the Apollo manifest, not its text.

## trustedDocuments.manifest: the entry "<id>" must map to a GraphQL source string

An entry's source is not a non-blank string. Regenerate the manifest.

## trustedDocuments.manifest: every id must be a non-empty string

An Apollo operation without an `id`, or a `Map` key that is not a string.

## trustedDocuments.manifest: the Apollo manifest "version" must be 1

Only version 1 of `apollo-persisted-query-manifest` is read.

## trustedDocuments.manifest: the Apollo manifest "operations" must be a list of { id, body }

The Apollo manifest has no `operations` list, or an entry is not an object.

## Too many requests, try again later.

A client spent a `fieldRateLimit` limit. HTTP `429`, code `RATE_LIMITED` (or your `code`),
`extensions.retryAfter` and a `Retry-After` header in seconds. Wait that long. If real users hit
it, raise the limit's `limit`, or check that `key` is not the proxy's address for everyone (see
[Rate limiting fields](./guide/rate-limiting.md)). Nothing counts when the key is `undefined`.

## <field> may be selected once per operation.

A field configured with `single: true` appears at two different places of one operation, for
example `{ a: signIn b: signIn }`. HTTP `400`, code `FIELD_SELECTED_ONCE`. Send one operation per
call, or drop `single`.

## fieldRateLimit: fields must be an object with at least one field name

`fields` is missing, empty or not an object. Pass `{ signIn: limit }`.

## fieldRateLimit: fields.<name> must be a limit ({ consume }) or { limit, single? }

The rule of `<name>` has no `consume` function, or `single` is not a boolean. Use
`memoryFieldLimit(...)`, `limitFromStore(...)`, your own `{ consume }`, or `{ limit, single: true }`.

## fieldRateLimit: ipv6Prefix must be an integer from 0 to 128

```ts
fieldRateLimit({ fields, ipv6Prefix: 64 });
```

## fieldRateLimit: ipv6Prefix only applies to the default key; reduce the address inside key() instead

`ipv6Prefix` reduces the address the default key reads. With your own `key`, drop `ipv6Prefix` and
reduce the address in `key`.

## fieldRateLimit: code must be a non-empty string

`code` is the `extensions.code` of a refusal: give a string, or leave it out for `RATE_LIMITED`.

## memoryFieldLimit: limit must be an integer of 1 or more

Also `windowMs` and `maxKeys`: `memoryFieldLimit: windowMs must be an integer of 1 or more`,
`memoryFieldLimit: maxKeys must be an integer of 1 or more`. Pass whole numbers (windows in milliseconds).

## limitFromStore: no policy; pass { limit, windowMs } or give the store a policy

The store has no `policy`: `limitFromStore(store, { limit: 10, windowMs: 60_000 })`.

## limitFromStore: limit <n> differs from the store policy's limit <m>

The same for `windowMs`. The store counts with its own policy; pass the same numbers or none.

## limitFromStore: limit must be an integer of 1 or more

Also `limitFromStore: windowMs must be an integer of 1 or more`: whole numbers, `windowMs` in milliseconds.

## telemetry must be false or an object

`telemetry` was `true`, a string or an array. Omit it (on when `@softistx/telemetry` is installed),
pass `false`, or pass an options object.

## telemetry.instance must be a @softistx/telemetry Telemetry

`instance` is not the object `createTelemetry(...)` returns. Pass it, or leave the option out to use
the installed one. A `tracer` option from before 0.4 throws its own error: see
[telemetry.tracer was replaced by telemetry.instance](#telemetrytracer-was-replaced-by-telemetryinstance).

## telemetry.tracer was replaced by telemetry.instance

The `telemetry` option still has `tracer`, the OpenTelemetry option of graxia before 0.4. Replace it
with `instance`, a `Telemetry` from `createTelemetry` in `@softistx/telemetry`, or leave it out to use
the installed one. See [Migrating](./guide/telemetry.md#migrating-from-opentelemetryapi).

## telemetry.document must be a boolean

Also `telemetry.propagate must be a boolean`. Pass `true` or `false`, or leave the option out.

## telemetry.resolverSpans must be a boolean or { trivial?: boolean }

Use `resolverSpans: true`, or `resolverSpans: { trivial: true }` to include fields with no resolver.

## No spans appear

The server answers but your backend shows nothing. In order:

1. `@softistx/telemetry` is not installed next to `@graxia/core`. It is an optional peer: graxia
   traces nothing without it. `bun add @softistx/telemetry`.
2. No telemetry is installed or passed. Without one, spans are detached and nothing is emitted:
   call `createTelemetry(...).install()` (or pass `telemetry: { instance }`) with an exporter, such
   as `@softistx/telemetry-otlp`'s `otlpExporter`.
3. Two copies of `@softistx/telemetry`: you installed the telemetry on one and graxia reads the
   other, so its spans are detached. Check `bun pm ls @softistx/telemetry` shows one version.
4. `telemetry: false` is set.
5. A request outside the GraphQL path (`path`) is not traced.

## A resolver span has no child spans of mine

A span you start inside a resolver nests under the active span. It is the resolver span (or the
operation span) when the telemetry is the one graxia emits to: with `telemetry: { instance }`, start
your span inside that same telemetry (`withTelemetry(instance, ...)` is already in scope in a
resolver). A span started from another copy of `@softistx/telemetry` is detached; see "No spans
appear".
