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

## Options

| option     | default    | what it does                                                                                                |
| ---------- | ---------- | ----------------------------------------------------------------------------------------------------------- |
| `schema`   | required   | any `GraphQLSchema` (`createSchema` output included)                                                        |
| `path`     | `/graphql` | the path served; other paths answer 404. `false` serves any path (your host routes)                         |
| `context`  | none       | `({ request, serverContext, params }) => object`, merged over `serverContext`, then `onContext` plugins run |
| `plugins`  | `[]`       | see [Plugins](./plugins.md)                                                                                 |
| `limits`   | see below  | document limits (`tokens`, `nesting`) and `bodyBytes` (default 1 MiB), see [Limits](./limits-and-caches.md) |
| `caches`   | on         | parse and validation caches, or `false`                                                                     |
| `batching` | `false`    | `false`, or `{ limit: n }`                                                                                  |

The context of an operation is `{ ...serverContext, ...(await context(...)) }`, then the `onContext`
hooks extend it. CORS is not handled: the host owns it.

## `serve` or your own `Bun.serve`

`graxia.serve(options)` is `Bun.serve({ ...options, fetch })`. To keep your own server and routes,
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

## Requests

- **POST** needs `Content-Type: application/json` (a charset, if given, must be UTF-8), otherwise 415.
  The body is `{ query, variables?, operationName?, extensions? }`; `null` means absent.
- **GET** reads `query`, `operationName`, and `variables` / `extensions` as URL-encoded JSON. A
  mutation over GET answers 405 with `Allow: POST`.
- **Accept**: `application/graphql-response+json` or `application/json`. A missing header, `*/*` and
  `application/*` answer `application/json`. Anything else answers 406. q-values are honoured.
- The body is read as a stream and counted: past `limits.bodyBytes` reading stops and the answer is
  413. `Content-Length` is checked first but never trusted alone.
- Other methods answer 405 with `Allow: GET, POST`.
- Subscriptions and `@defer` / `@stream` are refused with a clear error for now.

## Status codes

| situation                                                   | `application/graphql-response+json`                  | `application/json` |
| ----------------------------------------------------------- | ---------------------------------------------------- | ------------------ |
| result with `data` (field errors included)                  | 200                                                  | 200                |
| parse or validation error, unknown operation, bad variables | 400                                                  | 200                |
| missing `query`; malformed JSON; wrong parameter types      | 400                                                  | 400                |
| mutation over GET                                           | 405 (`Allow: POST`)                                  | 405                |
| path / method / `Accept` / `Content-Type` / size            | 404 / 405 / 406 / 415 / 413                          | same               |
| plugin hook threw, `context` threw, `execute` threw         | 500 `{ errors: [{ message: "Unexpected error." }] }` | same               |

Unexpected failures never leak their message. The body is generic whatever the cause.

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
`limit` entries, an empty array or a malformed entry answers 400. A plugin that short-circuits or
fails in an entry ends the whole batch with that response.

## Request id

Each request gets `crypto.randomUUID()`, stored in the request state under `requestIdKey` and sent
as the `x-request-id` response header, on every response. A client's `x-request-id` is never
trusted nor echoed.

```ts
import { requestIdKey } from '@graxia/core';

const log = definePlugin()({
	name: 'log',
	onRequest: ({ state }) => console.log('request', state.get(requestIdKey)),
});
```
