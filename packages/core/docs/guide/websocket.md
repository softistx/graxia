# Subscriptions over WebSocket

`createGraxia` serves GraphQL over WebSocket in the
[`graphql-transport-ws`](https://github.com/enisdenjo/graphql-ws/blob/master/PROTOCOL.md)
protocol (the one the `graphql-ws` client speaks), on Bun's native WebSocket. The legacy
`subscriptions-transport-ws` protocol is not supported. It is on by default and shares the HTTP
path: a request with `Upgrade: websocket` and the `graphql-transport-ws` subprotocol to `/graphql`
becomes a socket.

Queries, mutations and subscriptions all run on a socket, through the same pipeline as HTTP
(plugins, limits, caches, masking, `getContext()`):

| operation                 | messages                                                                       |
| ------------------------- | ------------------------------------------------------------------------------ |
| query, mutation           | one `next`, then `complete`                                                    |
| subscription              | one `next` per event, then `complete` at the end                               |
| `@defer` / `@stream`      | one `next` per incremental payload (in the configured format), then `complete` |
| parse or validation error | one `error` (the errors array); no `next`, no `complete`                       |

## Serve

```ts
import { createGraxia } from '@graxia/core';

const graxia = createGraxia({ schema });
graxia.serve({ port: 3000 }); // HTTP, SSE and ws://localhost:3000/graphql
```

## Client

```ts
// bun add graphql-ws
import { createClient } from 'graphql-ws';

const client = createClient({
	url: 'ws://localhost:3000/graphql',
	connectionParams: { token: 'secret' },
});
for await (const result of client.iterate({ query: 'subscription { tick }' }))
	console.log(result.data);
```

## Authentication

`connectionParams` (the payload of `connection_init`) reach `onConnect` and every operation's
context as `connectionParams` (`undefined` when the client sent none). `onConnect` runs before
the acknowledgement:

```ts
createGraxia({
	schema,
	subscriptions: {
		ws: {
			onConnect: ({ connectionParams, request }) => {
				// request: the upgrade request (cookies, headers); false closes with 4403
				return connectionParams?.token === 'secret';
			},
			onDisconnect: ({ connectionParams }) =>
				console.log('bye', connectionParams),
		},
	},
});
```

- Return `false`, or throw an `exposedError`, to refuse the connection with **4403** `Forbidden`.
  Any other throw is reported through `onUnexpected` and closes with **1011**.
- Return an object to send it as the `connection_ack` payload (what `graphql-ws` does).
- `onDisconnect` runs once for each connection that was acknowledged, whatever the close code.
- Plugins' `onRequest` hooks run on the upgrade request and may `respond` to refuse it (the
  client then sees a failed handshake); the request id is assigned there and kept for the whole
  connection. `onResponse` hooks do not run: Bun writes the handshake response. Each operation
  gets its own forked state, like a batch entry.

## Origin and cookie-authenticated browser apps

A browser sends the user's cookies with a WebSocket upgrade to any site, so graxia checks the
upgrade's `Origin` itself (unless `csrf: false`). An upgrade whose `Origin` is `null` or another
site's is refused with 403 `FORBIDDEN_ORIGIN` before the socket opens; a request with no `Origin`
(a non-browser client) is allowed. List the browser origins that may connect:

```ts
createGraxia({
	schema,
	csrf: { sameOrigin: { allowedOrigins: ['https://app.example.com'] } },
});
```

`csrf: false` turns the check off. You can also authenticate with `connectionParams`: send a token
in `connection_init`, check it in `onConnect`, and ignore the cookie. See
[Security](./security.md) for the details.

## Options

```ts
createGraxia({
	schema,
	subscriptions: {
		ws: {
			connectionInitWaitTimeout: 3_000, // default; closes 4408 when connection_init is late
			keepAliveMs: 12_000, // default; server `ping` messages; 0 turns them off
			maxPayloadBytes: 1_048_576, // default; Bun closes the socket with 1009 above it
			onConnect,
			onDisconnect,
		},
	},
});
```

`ws: false` turns WebSocket off: an upgrade request gets the normal HTTP handling. `ws: true` is
the default. Invalid numbers throw a `GraxiaConfigError` (see
[Troubleshooting](../troubleshooting.md)).

## Your own `Bun.serve`

```ts
const graxia = createGraxia({ schema });

Bun.serve({
	port: 3000,
	fetch: (request, server) =>
		graxia.isUpgrade(request)
			? graxia.upgrade(request, server)
			: graxia.fetch(request, { server }),
	websocket: graxia.websocket,
});
```

`graxia.isUpgrade(request)` is true for a request with `Upgrade: websocket` while `subscriptions.ws`
is on. `graxia.upgrade(request, server, serverContext?)` resolves `undefined` once the socket is
upgraded, and otherwise the `Response` to send: the refusal (wrong path, a plugin's `respond`, a
missing subprotocol, shutdown), with the request id and the sealed headers. Guard it with
`isUpgrade`; on a request that is not an upgrade (or with `ws: false`) it answers like
`graxia.fetch`, so the hooks run once either way. `serverContext` is typed like `fetch`'s
(required when the `context` factory's `ContextInit<…>` has required keys, see [the host's `serverContext`](./context.md#the-hosts-servercontext)) and merged into every operation's context.

The [host-embedding example](https://github.com/softistx/graxia/tree/develop/examples/host-embedding) serves WebSocket, SSE and HTTP on one route of its own `Bun.serve`.

`GraxiaSocketData` is the opaque type of `ws.data`; `serve()` returns `Bun.Server<GraxiaSocketData>`.
You need it only to annotate your own server or `websocket` handler.

## Close codes

| code | reason                               | when                                                          |
| ---- | ------------------------------------ | ------------------------------------------------------------- |
| 1001 | `Going away`                         | `dispose()` closes every open socket                          |
| 1009 | (Bun)                                | a message is larger than `maxPayloadBytes`                    |
| 1011 | `Internal error`                     | `onConnect` threw an unexpected error, or the handler failed  |
| 4400 | what was wrong                       | invalid JSON, unknown `type`, bad `id` or `subscribe` payload |
| 4401 | `Unauthorized`                       | `subscribe` before `connection_ack`                           |
| 4403 | `Forbidden`                          | `onConnect` returned `false` or threw an exposed error        |
| 4408 | `Connection initialisation timeout`  | no `connection_init` within `connectionInitWaitTimeout`       |
| 4409 | `Subscriber for <id> already exists` | `subscribe` with the id of an active operation                |
| 4429 | `Too many initialisation requests`   | a second `connection_init`                                    |

## Cancellation and shutdown

An operation's `signal` (also in the context) aborts when the client sends `complete` for it, the
socket closes, or the server shuts down. The client's `complete` stops the operation with no
`complete` message back. A closed socket aborts all its operations, calls `return()` on their
sources (a memory PubSub's `subscriberCount` drops to 0) and clears its timers.

`dispose()` aborts the operations and closes every open socket with **1001**, without waiting
`shutdownTimeout` for idle ones. The drain that lets an incremental query finish is for HTTP only
(multipart/mixed, SSE): over WebSocket every operation on the socket ends at once. Upgrades during shutdown get the `503 SHUTTING_DOWN` response.

## Errors

Parse and validation errors are an `error` message and end the operation. Execution errors are a
`next` with `errors`. Unexpected errors are masked with the correlation id (the connection's
request id) and reported once through `onUnexpected`, like over HTTP. An error thrown by a
subscription's source iterator after it has yielded ends the operation with a last `next` carrying
`errors`, then `complete`: a `GraphQLError` is exposed as is, a plain `Error` is masked and reported.
