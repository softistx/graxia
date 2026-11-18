# @graxia/core

The Bun-native GraphQL server engine: typed plugins, graphql 17, GraphQL over HTTP, with no
adapter layer. Pass a schema, get a `fetch` handler that follows the
[GraphQL over HTTP](https://graphql.github.io/graphql-over-http/) spec (it passes every
`graphql-http` server audit).

> Pre-1.0: the API is settling. Expect minor versions to change it, with the change in the
> changelog; pin a minor until 1.0.

## Requirements

- [Bun](https://bun.sh) 1.4.4 or later (the `engines` field). No Node or Deno adapter.
- `graphql` `^17.1.0`, as a peer dependency (17.1.0 is the version the suite runs against).
- `typescript` is an optional peer, for types. Use `"moduleResolution": "bundler"` in your
  `tsconfig.json`. `nodenext` resolves the published declarations too (the release build checks
  both resolutions), but the sources are written for a bundler.

## Install

```sh
bun add @graxia/core graphql@^17
```

The snippets below reuse the `graxia` and `schema` of the quick start instead of repeating them.

## Quick start

```ts
import { createGraxia, createSchema } from '@graxia/core';

const schema = createSchema()({
	typeDefs: 'type Query { hello(name: String = "world"): String }',
	resolvers: { Query: { hello: (_root, { name }) => `hello ${name}` } },
});

const graxia = createGraxia({ schema });
graxia.serve({ port: 3000 }); // POST or GET http://localhost:3000/graphql
```

```sh
curl -s localhost:3000/graphql -H 'content-type: application/json' \
  -d '{"query":"{ hello(name: \"Ada\") }"}'
# {"data":{"hello":"hello Ada"}}
```

To keep your own `Bun.serve` and routes, mount the handler: `Bun.serve({ fetch: graxia.fetch })`.
Details in [GraphQL over HTTP](./docs/guide/http.md).

## Plugins

A plugin is a plain object with a `name` and the hooks it needs (`onRequest`, `onParams`,
`onParse`, `onValidate`, `onContext`, `onExecute`, `onResponse`, ...). Returning a function from a
hook runs it after the stage (except `onContext` and `onResponse`, which have no
after-hook; `onResponse` replaces the response with `setResponse`).

```ts
import { createGraxia, definePlugin } from '@graxia/core';

const timing = definePlugin({
	name: 'timing',
	onRequest: () => {
		const start = performance.now();
		return () => console.log(`took ${performance.now() - start}ms`);
	},
});

createGraxia({ schema, plugins: [timing] });
```

A plugin that reads something from the context declares it with the curried form,
`definePlugin<{ request: Request }>()({ ... })`, so `onContext` still infers what it adds. See
[Plugins](./docs/guide/plugins.md) and its [Typed context](./docs/guide/plugins.md#typed-context) section.

## Context and `getContext`

The `context` option builds one context per operation; resolvers get it as their third argument,
and any code they call can read it with `getContext()`.

```ts
import { createGraxia, createSchema, getContext } from '@graxia/core';

const schema = createSchema<{ user: string }>()({
	typeDefs: 'type Query { me: String }',
	resolvers: { Query: { me: () => getContext<{ user: string }>().user } },
});

const graxia = createGraxia({
	schema,
	context: ({ request }) => ({
		user: request.headers.get('x-user') ?? 'anonymous',
	}),
});

// Stop cleanly: drains in-flight operations, answers 503 to new ones.
process.on('SIGTERM', () => graxia.dispose());
```

Every context also carries a `signal` that aborts when the client leaves or the server shuts
down. See [Context, cancellation and shutdown](./docs/guide/context.md).

## Errors

Throw `exposedError` to show an error to the client; anything else is masked as
`Unexpected error.` with a correlation id equal to the `x-request-id` header.

```ts
import { createGraxia, createSchema, exposedError } from '@graxia/core';

const schema = createSchema()({
	typeDefs: 'type Query { book(id: ID!): String }',
	resolvers: {
		Query: {
			book: (_root, args) => {
				throw exposedError('NOT_FOUND', `No book ${String(args.id)}.`, {
					fix: 'Check the id.',
				});
			},
		},
	},
});

createGraxia({
	schema,
	onUnexpected: (error, { correlationId }) =>
		console.error(correlationId, error), // the original error, for your logs
});
```

See [Errors](./docs/guide/errors.md).

## Limits and caches

Here `graxia` is the instance from the quick start. Documents are parsed under token and nesting limits, operations are refused over
a depth, alias, directive, root field or cost limit (all on by default), and parsed and validated documents are cached.
See [Security](#security).

```ts
createGraxia({
	schema,
	limits: {
		tokens: 15_000,
		nesting: 1_000,
		bodyBytes: 1_048_576,
		depth: 12,
		aliases: 30,
		directives: 50,
		rootFields: 20,
		cost: { max: 5_000 }, // @cost / @listSize; `false` turns a limit off
	},
	caches: { parse: { max: 1024, ttlMs: 3_600_000 } }, // or `false`
	batching: { limit: 10 }, // off by default
});
```

See [Limits and caches](./docs/guide/limits-and-caches.md).

## Security

graxia is a transport and plugin engine, not a hardened edge. What it does, and what it does not:

**On by default**

- Error masking: a resolver error that is not an `exposedError` or a `GraphQLError` reaches the
  client as `Unexpected error.` with a correlation id; the original goes to `onUnexpected`.
- A request body limit (`limits.bodyBytes`, 1 MiB; more answers 413).
- Document limits before parsing: at most 15 000 tokens and 1 000 nesting levels
  (`limits.tokens`, `limits.nesting`); a failure is `GRAPHQL_PARSE_FAILED`.
- Operation limits: depth 12, 30 aliases, 50 directives, 20 root fields and a cost of 5 000
  (`limits.depth`, `.aliases`, `.directives`, `.rootFields`, `.cost`), fragments expanded; a refusal is
  `GRAPHQL_VALIDATION_FAILED` with `extensions.limit`. Cost follows `@cost` / `@listSize`, which
  `createSchema` adds to your SDL (`costDirectives` does for a schema you build yourself);
  `computeOperationCost` returns an operation's cost for plugins and tests.
- Batching is off unless you set `batching: { limit }`.
- A client's `x-request-id` is never trusted or echoed; graxia generates the id.
- Server-sent events and WebSocket (`subscriptions.sse`, `subscriptions.ws`) are on, on the endpoint's
  path; turn either off with `false`.

- CSRF prevention: a request a browser can send cross-site without a preflight (a `GET`, or a
  `POST` with a `text/plain`, form or multipart body) is refused with 403 unless it carries one of
  `x-graphql-csrf`, `graphql-require-preflight`, `apollo-require-preflight` or
  `x-apollo-operation-name`. A JSON `POST` needs nothing.
- WebSocket origin check: an upgrade whose `Origin` is `null` or another site's is refused with
  403; list the browser origins that may connect in `csrf.sameOrigin.allowedOrigins`.
- Introspection and "Did you mean" suggestions are on in development and off when
  `NODE_ENV=production` (`introspection`, `suggestions`).

```ts
createGraxia({
	schema,
	csrf: { sameOrigin: { allowedOrigins: ['https://app.example.com'] } }, // also checks Origin over HTTP
	introspection: false,
});
```

See [Security](./docs/guide/security.md) for client setup, the `sameOrigin` modes and `NODE_ENV`.

**Not yet**

- A field rate limit.
- Trusted or persisted documents: any valid document runs.

These are planned (see the [roadmap](./docs/roadmap.md)). Meanwhile put the endpoint behind a proxy
or gateway that rate-limits and caps request cost.

## `execute`

Run an operation in process (`graxia` is the instance from the quick start), through the same pipeline as HTTP (plugins, context, masking), for
tests, jobs and scripts.

```ts
const { data, errors } = await graxia.execute({
	document: 'query Greet($name: String) { hello(name: $name) }',
	variables: { name: 'Ada' },
	headers: { authorization: 'Bearer test' },
});
```

It rejects with a `GraxiaExecuteError` when a plugin answered with its own response (a 401, for
example) instead of a result. See [Testing](./docs/guide/testing.md).

## Testing client

`graxia` is the instance from the quick start. `@graxia/core/testing` sends requests through `graxia.fetch` with real HTTP semantics, without a
socket and without importing a test runner.

```ts
import { createTestClient, expectNoErrors } from '@graxia/core/testing';

const client = createTestClient(graxia, {
	headers: { 'x-request-source': 'test' },
});
const result = await client.query<{ hello: string }>('{ hello }');
expectNoErrors(result);
result.status; // 200
result.data?.hello; // 'hello world'
```

## Key-value cache

`KeyValueCache` (with `CacheSetOptions`) is a small asynchronous string store; `createMemoryCache` is the
in-process LRU implementation with a per-entry `ttlMs`. `redisCache` in `@graxia/redis` is the shared one.

```ts
import { createMemoryCache } from '@graxia/core';

const cache = createMemoryCache({ maxEntries: 500 });
await cache.set('greeting', 'hello', { ttlMs: 60_000 });
await cache.get('greeting'); // 'hello'
```

See [limits and caches](./docs/guide/limits-and-caches.md).

## PubSub

A typed in-memory PubSub for subscription resolvers. It lives in one process; for several
instances, `redisPubSub` from `@graxia/redis` implements the same interface.

```ts
import { createMemoryPubSub, createSchema } from '@graxia/core';

const pubsub = createMemoryPubSub<{ tick: number }>();

// This `schema` is the one the subscription examples below use.
const schema = createSchema<{ signal: AbortSignal }>()({
	typeDefs: 'type Query { hello: String } type Subscription { tick: Int! }',
	resolvers: {
		Query: { hello: () => 'world' },
		Subscription: {
			tick: {
				subscribe: (_root, _args, ctx) =>
					pubsub.subscribe('tick', { signal: ctx.signal }),
				resolve: (n: number) => n,
			},
		},
	},
});

await pubsub.publish('tick', 1);
// `filterIterable(source, keep)` and `mapIterable(source, map)` wrap a subscription's source.
```

## Subscriptions

Subscriptions are served over server-sent events (`graphql-sse`, distinct connections mode) to any
request whose `Accept` prefers `text/event-stream`, on by default. `graxia.serve()` keeps the
connection open; a keep-alive comment is sent every 12 s (`subscriptions.sse.keepAliveMs`, `0` turns it off).

```ts
// server: `createGraxia({ schema })` with the PubSub example's `schema`; publish with `pubsub.publish('tick', 1)`
// client: bun add graphql-sse
import { createClient } from 'graphql-sse';

const client = createClient({ url: 'http://localhost:3000/graphql' });
for await (const result of client.iterate({
	query: 'subscription { tick }',
}))
	console.log(result.data);
```

`onSubscribe` and `onResultChunk` plugin hooks run on these streams. See
[Subscriptions](./docs/guide/subscriptions.md).

### Over WebSocket

`graphql-transport-ws` on Bun's WebSocket is on by default, on the same path, for the `graphql-ws`
client. `connectionParams` reach `onConnect` and the context; `dispose()` closes sockets with 1001.

```ts
const live = createGraxia({
	schema,
	subscriptions: {
		ws: {
			onConnect: ({ connectionParams }) => connectionParams?.token === 'secret',
		},
	},
});
live.serve({ port: 3000 }); // ws://localhost:3000/graphql

// your own Bun.serve:
//   fetch: (req, server) =>
//     live.isUpgrade(req) ? live.upgrade(req, server) : live.fetch(req, { server }),
//   websocket: live.websocket
```

A cookie-authenticated browser app must also check `Origin` on the upgrade: see [Security](#security).

See [Subscriptions over WebSocket](./docs/guide/websocket.md): auth, close codes, keep-alive, limits.

## `@defer` and `@stream`

Queries and mutations with `@defer` or `@stream` are delivered incrementally to a client that sends
`Accept: multipart/mixed` (or `text/event-stream`), on by default; any other `Accept` gets
`INCREMENTAL_NOT_SUPPORTED` (HTTP 400 under `application/graphql-response+json`, 200 under `application/json`). `incremental: { format: 'legacy' }` speaks the 2022-08 format older
clients read, `incremental: false` turns it off.

A client example with `meros` is in the [guide](./docs/guide/incremental.md#a-client).

**Running the schema elsewhere.** `createSchema` declares `@defer` and `@stream`, so graphql's plain
`execute` refuses its schemas; use graxia or `experimentalExecuteIncrementally`, or build with
`createSchema()({ typeDefs, resolvers, incremental: false })` (no incremental queries then).

## Exports

| import                 | what it is                                                                                                                                               |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@graxia/core`         | Server: `createGraxia`. Schema: `createSchema`. Plugins: `definePlugin`, `createStateKey`, `getRequestId`                                                |
|                        | PubSub: `createMemoryPubSub`, `filterIterable`, `mapIterable`; types `PubSub`, `PubSubTopics`, `SubscribeOptions`, `MemoryPubSub`, `MemoryPubSubOptions` |
|                        | Cache: `createMemoryCache`; types `KeyValueCache`, `CacheSetOptions`                                                                                     |
|                        | Context: `getContext`, `tryGetContext`                                                                                                                   |
|                        | Errors: `exposedError`, `GraxiaError`, `isGraxiaError`, `GraxiaConfigError`, `GraxiaPluginError`, `GraxiaExecuteError`; plus the types of all of these   |
|                        | Options: `SubscriptionsOptions`, `WebSocketOptions`, `WebSocketContext`, `IncrementalOptions`, `GraxiaSocketData`                                        |
| `@graxia/core/testing` | `createTestClient` and `expectNoErrors`, for tests                                                                                                       |

## Documentation

- [Guides and index](./docs/README.md)
- [GraphQL over HTTP](./docs/guide/http.md): `createGraxia`, `fetch` / `serve`, status codes, batching, request id.
- [Plugins](./docs/guide/plugins.md): hooks, ordering, short-circuit, request state, typed context.
- [Context, cancellation and shutdown](./docs/guide/context.md): `getContext()`, `signal`, `dispose()`.
- [Subscriptions](./docs/guide/subscriptions.md): server-sent events, keep-alive, cancellation, Bun idle timeout.
- [Subscriptions over WebSocket](./docs/guide/websocket.md): `graphql-transport-ws`, auth, close codes, own `Bun.serve`.
- [Errors](./docs/guide/errors.md): `exposedError`, masking, correlation ids, `onUnexpected`.
- [Testing](./docs/guide/testing.md): `graxia.execute`, typed documents, the test client.
- [Schema](./docs/guide/schema.md): `createSchema`, SDL, typed resolvers, codegen resolvers.
- [`@defer` and `@stream`](./docs/guide/incremental.md): multipart/mixed and SSE, formats, clients, masking.
- [PubSub](./docs/guide/pubsub.md): typed topics, the in-memory PubSub, filter and map helpers.
- [Limits and caches](./docs/guide/limits-and-caches.md): parse limits and the parse and validation caches.
- [Troubleshooting](./docs/troubleshooting.md): every error message, why it happens and the fix.
- [Roadmap](./docs/roadmap.md): what ships next.

## License

MIT
