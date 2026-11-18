# GraphQL over HTTP

`createGraxia` serves a schema over [GraphQL over HTTP](https://graphql.github.io/graphql-over-http/)
on Bun. It passes every MUST and SHOULD of the `graphql-http` server audits (61 audits, run against
a real `Bun.serve` in this package's specs).

```ts
import { createGraxia, createSchema } from '@graxia/core';

const schema = createSchema()({
	typeDefs: 'type Query { hello: String }',
	resolvers: { Query: { hello: () => 'world' } },
});

const graxia = createGraxia({ schema });
graxia.serve({ port: 3000 }); // POST/GET http://localhost:3000/graphql
```

`graxia.ready` is a promise that resolves once every plugin's `setup` ran and rejects with the
error of the first one that failed; `await graxia.ready` at startup to fail fast (see
[Plugins](./plugins.md#setup-and-dispose)).

## Options

| option            | default                                           | what it does                                                                                                                                            |
| ----------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schema`          | required                                          | any `GraphQLSchema` (`createSchema` output included)                                                                                                    |
| `path`            | `/graphql`                                        | the path served; other paths answer 404. `false` serves any path (your host routes)                                                                     |
| `context`         | none                                              | `({ request, serverContext, params, signal }) => object`, merged over `serverContext`, then `onContext` plugins run                                     |
| `plugins`         | `[]`                                              | see [Plugins](./plugins.md)                                                                                                                             |
| `limits`          | `tokens` 15000, `nesting` 1000, `bodyBytes` 1 MiB | document limits and body size, see [Limits](./limits-and-caches.md)                                                                                     |
| `caches`          | on                                                | parse and validation caches, or `false`                                                                                                                 |
| `batching`        | `false`                                           | `false`, or `{ limit: n }`                                                                                                                              |
| `asyncContext`    | `true`                                            | `getContext()` through `AsyncLocalStorage`, see [Context](./context.md)                                                                                 |
| `shutdownTimeout` | `10000`                                           | milliseconds `dispose()` waits for in-flight operations                                                                                                 |
| `onUnexpected`    | `console.error` outside production                | `(error, { requestId, correlationId, phase }) => void` called for every unexpected failure, or `false` to stay silent. Its own exceptions are swallowed |

The context of an operation is `{ ...serverContext, ...(await context(...)) }`, then the `onContext`
hooks extend it. CORS is not handled: the host owns it. Invalid options (`limits.bodyBytes` or
`batching.limit` not a positive integer, a `path` not starting with `/`) throw a `GraxiaConfigError`
naming the option when `createGraxia` is called.

## `serve` or your own `Bun.serve`

`graxia.serve(options)` is `Bun.serve({ ...options, fetch })`; Bun's `server` is forwarded in the
`serverContext` (`context.server`), for WebSocket upgrades and client addresses. To keep your own server and routes,
mount `graxia.fetch` (it never rejects and returns a plain `Response`):

```ts
const graxia = createGraxia({ schema, path: false });

Bun.serve({
	port: 3000,
	routes: {
		'/health': () => new Response('ok'),
		'/api/graphql': (request) => graxia.fetch(request, { tenant: 'acme' }),
	},
});
```

The second argument is the `serverContext`, merged into every operation's context. With `path: false`
graxia answers whatever path it is handed.

The host context is typed by `createGraxia<HostCtx>`: when `HostCtx` has a required key, the
`serverContext` of `fetch`, of `graxia.execute` and of `serve` (`graxia.serve({ serverContext })`)
is required too, and leaving it out is a type error; when every key is optional (or there is no
`HostCtx`) it stays optional. `serve` adds `server` (Bun's server) to it. The compiler does not
check that this context matches what your schema's resolvers or plugins expect (see
[Context](./context.md#how-the-context-is-built)).

## Requests

- **POST** needs `Content-Type: application/json` (a charset, if given, must be UTF-8), otherwise 415.
  The body is `{ query, variables?, operationName?, extensions? }`; `null` means absent.
- **GET** reads `query`, `operationName`, and `variables` / `extensions` as URL-encoded JSON. A
  mutation over GET answers 405 with `Allow: POST`, decided right after parsing and before validation.
- **Accept**: `application/graphql-response+json` or `application/json`. A missing header, `*/*` and
  `application/*` answer `application/json`. Anything else answers 406. q-values are honoured (clamped
  to 0..1; an explicit `q=0` excludes a type even when a wildcard would match). Responses carry
  `Vary: Accept`.
- The body is read as a stream and counted: past `limits.bodyBytes` reading stops and the answer is
  413. `Content-Length` is checked first but never trusted alone.
- Other methods answer 405 with `Allow: GET, POST`.
- **Event streams**: an `Accept` that prefers `text/event-stream` (named, never through a wildcard,
  with a q at least that of the JSON types) answers an event stream for any operation; see
  [Subscriptions](./subscriptions.md). Without it, a subscription (`SUBSCRIPTION_NOT_SUPPORTED`) and
  `@defer` / `@stream` (`INCREMENTAL_NOT_SUPPORTED`) are refused with a 400 under
  `application/graphql-response+json` (200 under `application/json`), the code in `extensions.code`.
  A batch with an event-stream `Accept` answers 400.

## Status codes

| situation                                                       | `application/graphql-response+json`                                                       | `application/json` |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------ |
| result with `data` (field errors included)                      | 200                                                                                       | 200                |
| parse or validation error, unknown operation, bad variables     | 400                                                                                       | 200                |
| missing `query`; malformed JSON; wrong parameter types          | 400                                                                                       | 400                |
| subscription, `@defer` / `@stream`                              | 400                                                                                       | 200                |
| mutation over GET                                               | 405 (`Allow: POST`)                                                                       | 405                |
| path / method / `Accept` / `Content-Type` / size                | 404 / 405 / 406 / 415 / 413                                                               | same               |
| client left, or shutdown past its timeout (`OPERATION_ABORTED`) | 499 / 503                                                                                 | same               |
| `dispose()` started (`SHUTTING_DOWN`)                           | 503 (`connection: close`)                                                                 | same               |
| plugin hook threw, `context` threw, `execute` threw             | 500 `{ errors: [{ message: "Unexpected error.", extensions: { code, correlationId } }] }` | same               |

Unexpected failures never leak their message. The body is generic whatever the cause
(`INTERNAL_SERVER_ERROR` and a `correlationId` equal to the `x-request-id` header); the original
error reaches `onUnexpected` with that id. A resolver that throws a plain error is masked the same
way inside a normal result (see [Errors](./errors.md)). `fetch` never rejects: a response Bun would refuse
(such as `Response.error()`) also becomes this 500. A throwing executor still runs the `onExecute`
after-hooks, and every after-hook runs exactly once on every path.

## Plugin headers

Every hook payload has `responseHeaders: Headers`. What a plugin sets there is merged into whatever
response ends the request, a 413 or a short-circuit included: `set-cookie` and `vary` are appended,
any other header is set only when the response does not already carry it.

```ts
const noStore = definePlugin()({
	name: 'no-store',
	onRequest: ({ responseHeaders }) => {
		responseHeaders.set('cache-control', 'no-store');
	},
});
```

Path and method refusals (404, 405) happen before any plugin runs. Every other response goes through
`onRequest` after-hooks and `onResponse`.

## Batching

Off by default: a JSON array body answers 400. With `batching: { limit: 10 }` an array runs its
entries **one after the other, in order** (a later entry may rely on an earlier mutation, and one
request cannot multiply its own concurrency) and answers 200 with an array of results. More than
`limit` entries, an empty array or a malformed entry answers 400. A hook that throws, or an
executor that throws, in entry _n_ becomes that entry's generic `Unexpected error.` body (with the request's `correlationId`)
in the array and the batch carries on (earlier mutations already ran, later entries still run). A
plugin that short-circuits with `respond` (in `onRequest`, or in an entry's `onParams`) is a decision
about the request and answers the whole request.

Each entry runs on its own forked [state](./plugins.md#per-request-state): writes in one entry are
not seen by the next, reads fall through to what `onRequest` set.

## Request id

Each request gets `crypto.randomUUID()`, kept in the request state and sent
as the `x-request-id` response header, on every response. A client's `x-request-id` is never
trusted nor echoed, so an invalid or hostile header changes nothing. Plugins read the id with
`getRequestId(state)`; they cannot set it.

```ts
import { getRequestId } from '@graxia/core';

const log = definePlugin()({
	name: 'log',
	onRequest: ({ state }) => console.log('request', getRequestId(state)),
});
```
