# Troubleshooting: subscriptions and incremental delivery

Subscription, WebSocket, server-sent events and `@defer`/`@stream` errors, headed by the message as it appears. The rest is in [Troubleshooting](./troubleshooting.md).

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

## The stream ends with `Unexpected error.` after some events

The subscription's source iterator threw a plain `Error` (a database or library failure) after it had
yielded. The client gets the masked message and a correlation id, the original goes to `onUnexpected`.
To tell the client why, throw a `GraphQLError` from the iterator: it is exposed
as is, its message and extensions (and path, when it sets one), then the stream completes.

```ts
import { GraphQLError } from 'graphql';

subscribe: async function* () {
	yield 1;
	throw new GraphQLError('The feed is down.', {
		extensions: { code: 'UPSTREAM_DOWN' },
	});
}
```

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

- `Not found.` (404, `PATH_NOT_FOUND`): the path is not graxia's `path`.
- `A WebSocket upgrade must be a GET request.` (405, `METHOD_NOT_ALLOWED`, `Allow: GET`).
- `The Sec-WebSocket-Protocol header must offer "graphql-transport-ws".` (400, `SUBPROTOCOL_REQUIRED`): no such subprotocol.
- `The WebSocket upgrade failed.` (400, `UPGRADE_FAILED`): Bun refused the upgrade, e.g. missing `Sec-WebSocket-Key`.

With `subscriptions: { ws: false }` the request is handled as plain HTTP.

## Batched operations cannot be sent over text/event-stream. (`BATCH_NOT_STREAMABLE`)

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

## Batched operations cannot be sent over multipart/mixed. (`BATCH_NOT_STREAMABLE`)

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
