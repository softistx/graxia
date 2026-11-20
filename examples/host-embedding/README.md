# host-embedding

An app that owns `Bun.serve` and embeds `@softistx/graxia` in one of its routes. Private, not published:
it is a worked example and the host the specs run against.

## What it shows

- **Prefix mount**: graxia is created with `path: '/api/graphql'` and called from the host's own route; `/health` and `/ready` live beside it.
- **Typed host context**: the host passes `{ set, user }` to `graxia.fetch(request, host)`; the context is declared once on the `context` factory and the schema uses `InferContext`. A request without it is a compile error.
- **Same-path WebSocket upgrade**: `graxia.isUpgrade` / `graxia.upgrade` in the same route, with `graxia.websocket` as `Bun.serve`'s `websocket`; SSE uses the same path too.
- **Host CORS**: graxia has no `cors` option; `cors.ts` answers the preflight and decorates the response.
- **Headers and cookies merge**: resolvers write to `set`; `respond.ts` merges it into the response after `fetch`.
- **Graceful stop order**: readiness goes 503, `graxia.dispose()` drains (in-flight answered, new requests 503 `SHUTTING_DOWN`, streams completed, sockets closed with 1001), then the server stops.

## Prerequisite

The example imports `@softistx/graxia`'s `dist`, so build first, at the repository root:

```sh
bun install && bun run build
```

## Run, test, typecheck

```sh
cd examples/host-embedding
bun run start        # http://localhost:3000, PORT to change it
bun run test
bun run typecheck
```

```sh
curl localhost:3000/api/graphql \
  -H 'content-type: application/json' -H 'x-user: ada' \
  -d '{"query":"{ hello me }"}'
# {"data":{"hello":"world","me":"ada"}}
```

## Files

| file         | role                                                                   |
| ------------ | ---------------------------------------------------------------------- |
| `app.ts`     | `createApp`: routes, the graphql handler, `stop()`                     |
| `context.ts` | `HostContext`, `ResponseSet`, the `context` factory and the `Ctx` type |
| `cors.ts`    | the host's CORS: preflight and response headers                        |
| `respond.ts` | merges the `set` bag (headers, cookies) into graxia's response         |
| `schema.ts`  | `hello`, `me`, `slow`, `login` (sets a cookie), `ticks` (subscription) |
| `main.ts`    | starts the app and wires `SIGTERM` / `SIGINT` to `stop()`              |

## Limits

- `x-user` is a stand-in that trusts the client. Put real authentication there (a verified session or token) before any real use.
- The `set` bag is ignored on SSE, multipart and WebSocket responses: those have already left, or have no response, when the resolver runs.

## See also

[GraphQL over HTTP](../../packages/core/docs/guide/http.md), [WebSocket](../../packages/core/docs/guide/websocket.md), [Context and shutdown](../../packages/core/docs/guide/context.md), and the [migration guide from `@alxia/graphql`](../../packages/core/docs/guide/migrating-from-alxia-graphql.md).
