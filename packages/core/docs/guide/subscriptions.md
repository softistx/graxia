# Subscriptions over server-sent events

`createGraxia` serves subscriptions over server-sent events (SSE), in the **distinct connections
mode** of the [`graphql-sse`](https://github.com/enisdenjo/graphql-sse/blob/master/PROTOCOL.md)
protocol: one HTTP request, one event stream. Single connection mode (reservations, stream tokens)
is not implemented. For `graphql-transport-ws` over WebSocket see [Subscriptions over
WebSocket](./websocket.md).

It is on by default. A request whose `Accept` header prefers `text/event-stream` gets an event
stream, for any operation type:

| operation       | events                                           |
| --------------- | ------------------------------------------------ |
| query, mutation | one `next`, then `complete`                      |
| subscription    | one `next` per event, then `complete` at the end |

```ts
import { createGraxia, createPubSub, createSchema } from '@graxia/core';

const pubsub = createPubSub<{ tick: [payload: number] }>();
const schema = createSchema<{ signal: AbortSignal }>()({
	typeDefs: `
		type Query { _: Int }
		type Subscription { tick: Int! }
	`,
	resolvers: {
		Subscription: {
			tick: {
				// the engine returns the iterator when the client leaves or the server shuts down
				subscribe: () => pubsub.subscribe('tick'),
				resolve: (n: number) => n,
			},
		},
	},
});

createGraxia({ schema }).serve({ port: 3000 });
```

The PubSub has Yoga's shape, so a Yoga resolver moves over unchanged: `subscribe('post', id)`,
`publish('post', id, payload)`, `pipe` / `filter` / `map`. See [PubSub](./pubsub.md) for the topic
typing, the "Coming from Yoga or Apollo" table and the 0.3 migration.

## Client

Any `graphql-sse` client works, in distinct connections mode (its default):

```ts
import { createClient } from 'graphql-sse';

const client = createClient({ url: 'http://localhost:3000/graphql' });
for await (const result of client.iterate({ query: 'subscription { tick }' }))
	console.log(result.data);
```

A browser `EventSource` cannot set headers, so a GET from it is refused with 403 `CSRF_HEADER_REQUIRED`. Either use `graphql-sse` (a POST with a JSON body), or accept header-less GETs with `csrf: { requireHeader: false }` and keep `csrf.sameOrigin` on, so cross-site pages are still refused (see [Security](./security.md)). Over the wire:

```
event: next
data: {"data":{"tick":1}}

event: complete
data:

```

## Options

```ts
createGraxia({
	schema,
	subscriptions: {
		// default `true`; `false` answers SUBSCRIPTION_NOT_SUPPORTED
		sse: {
			keepAliveMs: 12_000, // default; keep-alive comments; 0 turns them off; an integer up to 2_147_483_647
		},
	},
});
```

Without `Accept: text/event-stream` a subscription still answers `SUBSCRIPTION_NOT_SUPPORTED`, and
the message says to request the event stream. `graxia.execute` and the test client do not run
subscriptions: `execute` of a subscription returns that refusal in the result.

## Behaviour

- **Headers**: `Content-Type: text/event-stream; charset=utf-8`, `Cache-Control: no-cache`,
  `X-Accel-Buffering: no`. The first bytes are a comment line (`:`) that flushes the headers, so the
  client knows it is connected before the first event.
- **Errors**: a request that cannot become an operation keeps its plain HTTP answer (bad body or
  parameters 400, wrong method 405, `Content-Type` 415, size 413, mutation over GET 405). Once the
  request is valid, parse, validation and execution errors, and a subscription failing before its
  first event, arrive as one `next` event carrying `{ errors }`, then `complete`, status 200, as the
  protocol asks. One exception: a subscription that fails before its source stream opens, with errors that carry
  `extensions.http` (`status` or `headers`), is answered as plain JSON like a query, with that status and those
  headers and `http` stripped from the body (`errorHttp: false` keeps the stream; see
  [Errors](./errors.md#status-and-headers-from-errors)). The same failure without `extensions.http`, and any failure after the first event,
  stay in the stream. A hook or an executor that throws unexpectedly answers the generic 500, or, once a
  stream is open, a last `next` with the generic `Unexpected error.` body and its correlation id.
- **Batching**: a batch (JSON array) is refused with 400 when `Accept` prefers the event stream; the
  protocol streams one operation per request.
- **Keep-alive**: a comment line every `sse.keepAliveMs` while the stream is open, so proxies do not
  close it.
- **Hooks**: `onSubscribe` runs for subscriptions like `onExecute` does for queries (`setExecuteFn`
  swaps `subscribe`, `setResult` answers with one result, the after-hook receives
  `{ result, setResult }` once the source exists). Every payload, including a query's single one, goes
  through the `onResultChunk` hooks (`setChunk`) and then error masking, in that order.
- **Masking**: a resolver error inside one event is masked like any other (`Unexpected error.` plus
  `correlationId`); the stream goes on. An error thrown by the source iterator while it iterates (after
  it has yielded) ends the stream with a last `next` carrying `{ errors }`, then `complete`: a
  `GraphQLError` (`exposedError` included) is exposed as is, its message and extensions (and path, when it sets one), and a plain
  `Error` is masked and reported through `onUnexpected`, like an execution error. That last payload goes through
  `onResultChunk` first (its `errors` hold the error: a non-`GraphQLError` arrives wrapped in a `GraphQLError` with `originalError`), so a plugin sees the failure: a chunk
  with `errors` and no `data` key is the source's failure, always the last payload. A thrown non-`Error`
  (a string, say) is reported as an `Error` of its string form. The operation's signal aborts when the
  stream ends, whatever the cause, with no reason. If a hook throws on this chunk, `onUnexpected` receives
  the source's error first, then the hook's, but only when the source's error is not a `GraphQLError`:
  a `GraphQLError` source with a throwing hook reports only the hook's error.
- **`getContext()`** works in subscription resolvers and for each event (`asyncContext`).

## Cancellation and shutdown

The operation's `signal` (in the context, and given to `subscribe`) aborts when the client
disconnects, and when `dispose()` runs. On a client disconnect, or when the response body is
cancelled, graxia calls the source iterator's `return()` and clears the keep-alive timer. Pass
`ctx.signal` to `pubsub.subscribe` so the subscriber is removed.

`dispose()` stops the open streams first: each sends `complete` and closes, so shutdown does not wait
for `shutdownTimeout` on subscriptions. A stream whose source ignores the abort is dropped at the end
of the timeout, like any operation. Over HTTP (multipart/mixed, SSE), an incremental query or mutation is not a subscription: it drains
within `shutdownTimeout` before it is cut (see [`@defer` and `@stream`](./incremental.md)).

A custom source (a `setResult` iterator, or your own `subscribe` function) must settle a pending
`next()` when `return()` is called, or listen to the operation's `signal`. A plain `async function*`
queues `return()` behind its pending `next()` and so cannot be stopped while it waits for an event.
graphql's `subscribe` and the memory PubSub already do this. A `return()` that throws or rejects is
ignored: the stream still ends and `dispose()` does not wait for it.

## Incremental queries

A query with `@defer` or `@stream` over `text/event-stream` sends one `next` event per payload, then
`complete`; see [`@defer` and `@stream`](./incremental.md). A subscription event that uses them is
refused with `INCREMENTAL_NOT_SUPPORTED`.

## Bun idle timeout

`Bun.serve` closes a connection that stays silent for `idleTimeout` seconds (10 by default). For an
event stream graxia calls `server.timeout(request, 0)` when the Bun server is in the context:
`graxia.serve()` does it for you. If you call `graxia.fetch` from your own `Bun.serve`, pass the
server, or a stream may be cut between two events:

```ts
const server = Bun.serve({
	fetch: (request, server) => graxia.fetch(request, { server }),
});
```

The call is a safeguard: in Bun 1.4.4 a probe of a silent streaming response was not cut at a 1 s
`idleTimeout` either way, but the documented default may apply on other versions or transports. Keep
`sse.keepAliveMs` under the idle timeout of any proxy in front of the server.
