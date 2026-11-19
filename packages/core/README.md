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
- `@softistx/telemetry` `^0.4.1` is an optional peer: with it installed graxia emits spans,
  without it tracing is off (see [Telemetry](#telemetry)).
- `typescript` is an optional peer, for types. Use `"moduleResolution": "bundler"` in your
  `tsconfig.json`. `nodenext` resolves the published declarations too (the release build checks
  both resolutions), but the sources are written for a bundler.

## Install

```sh
bun add @graxia/core graphql@^17
bun add @softistx/telemetry  # optional, enables spans
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
after-hook; `onResponse` replaces the response with `setResponse`). A plugin may also declare
`csrfExempt(request)` for its own `GET` requests (see [Security](./docs/guide/security.md)); for an
in-browser explorer see `@graxia/graphiql`.

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

## Context, written once

The `context` option builds one context per operation. Write it once, derive its type with
`InferContext`, and resolvers get it as their third argument. `createGraxia` then checks, at compile
time, that the schema's context is what the factory, the plugins and graxia provide.

```ts
import {
	type ContextInit,
	createGraxia,
	createSchema,
	type InferContext,
} from '@graxia/core';

const context = async ({ request }: ContextInit) => ({
	user: await authenticate(request), // { id: string } | null
});
type Ctx = InferContext<typeof context>; // { user: … } & { signal: AbortSignal }

const schema = createSchema<Ctx>()({
	typeDefs: 'type Query { me: String }',
	resolvers: { Query: { me: (_, __, ctx) => ctx.user?.id } },
});

const graxia = createGraxia({ schema, context }); // a missing or wrong key is a type error

// Stop cleanly: drains in-flight operations, answers 503 to new ones.
process.on('SIGTERM', () => graxia.dispose());
```

Plugins that add context go in the second parameter, `InferContext<typeof context, typeof plugins>`.
Every context also carries a `signal` that aborts when the client leaves or the server shuts down;
`getContext()` reads the context from code far below a resolver. See
[Context, cancellation and shutdown](./docs/guide/context.md).

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
  `DEFAULT_CSRF_HEADERS` (`x-graphql-csrf`, `graphql-require-preflight`,
  `apollo-require-preflight`, `x-apollo-operation-name`). A JSON `POST` needs nothing.
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
A plugin that serves its own `GET` page (such as the GraphiQL explorer of `@graxia/graphiql`) can exempt it from the header with `csrfExempt`; core still refuses an exempt request no plugin answers.

**Opt-in**

- Trusted documents (`trustedDocuments`): see below.
- Field rate limits (`fieldRateLimit`): see below.

Rate-limit the endpoint as a whole in a proxy or gateway.

## Rate limiting fields

Limit how often a client selects chosen fields, counted across aliases and fragments (three aliased
`signIn` in one request spend 3 units). Past a limit nothing executes: `429` with `Retry-After`.

```ts
import { createGraxia, fieldRateLimit, memoryFieldLimit } from '@graxia/core';

createGraxia({
	schema,
	plugins: [
		fieldRateLimit({
			fields: {
				signIn: {
					limit: memoryFieldLimit({ limit: 5, windowMs: 60_000 }),
					single: true,
				},
			},
			// key: (ctx) => ctx.userId, ipv6Prefix: 64, code: 'RATE_LIMITED'
		}),
	],
});
```

`single: true` also refuses the field selected twice in one operation (`400`,
`FIELD_SELECTED_ONCE`). The default key is the client address `serve()` read; give `key` behind a
proxy or with `fetch()`. Use `redisFieldLimit` from `@graxia/redis` to share the limit across processes. See
[Rate limiting fields](./docs/guide/rate-limiting.md).

## Telemetry

Install `@softistx/telemetry` (an optional peer) and an exporter (`@softistx/telemetry-otlp` for an
OTLP backend), then `createTelemetry(...).install()`: graxia emits spans for each request, parse,
validation and operation, and the original exception of an unexpected error. Without the peer,
nothing is wrapped and nothing runs.

```ts
createGraxia({ schema, telemetry: { resolverSpans: true } }); // or `telemetry: false`
```

Setup, the span tree, attributes, every option and the migration from `@opentelemetry/api`:
[Telemetry](./docs/guide/telemetry.md).

## Trusted documents

Let production run only the documents your clients ship: a manifest (Relay, graphql-codegen or
Apollo format), `documentId`, automatic persisted queries and a strict mode.

```ts
createGraxia({
	schema,
	trustedDocuments: {
		manifest: await Bun.file('persisted-documents.json').json(),
		// mode: 'strict' when NODE_ENV=production, 'mixed' otherwise
		// store: redisCache({ url }) shares APQ registrations across processes
	},
});
// POST { "documentId": "a3f1..." }, GET ?documentId=..., or an APQ hash in extensions.persistedQuery
```

In `strict` a query sent in full is refused with `PERSISTED_QUERY_ONLY`. Without the option nothing
changes. See [Trusted documents](./docs/guide/trusted-documents.md).

## Production

Set `NODE_ENV=production`: introspection and "Did you mean" hints go off, trusted documents run in
`strict` mode, and the unexpected-error log goes quiet. Masked errors, CSRF checks, operation
limits, no batching and a server-made request id are on in every environment. Give
`trustedDocuments` your manifest, share the rate-limit and PubSub state across instances, set
`csrf.sameOrigin.allowedOrigins` and call `graxia.dispose()` on `SIGTERM`. The
[production guide](./docs/guide/production.md) has the full configuration and a checklist.

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

With `trustedDocuments`, `graxia.execute({ documentId, variables })` runs a persisted document by
id (without it the result is `Must provide a query string.`).

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

## Ready for agents

`@graxia/core/agent` adds descriptive `@needs`, `@constraint` and `@errors` directives, prints the schema one caller may see, and lints descriptions. Every error graxia emits carries `extensions.fix`.

```ts
import {
	agentTypeDefs,
	lintDescriptions,
	printSchemaFor,
} from '@graxia/core/agent';

// createSchema()({ typeDefs: [agentTypeDefs, sdl], resolvers })
const sdl = printSchemaFor(schema, {
	can: (permission) => permissions.has(permission),
});
expect(lintDescriptions(schema)).toEqual([]); // in a spec
```

See [Ready for agents](./docs/guide/agent.md).

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
import { createPubSub, createSchema } from '@graxia/core';

const pubsub = createPubSub<{ tick: [payload: number] }>();

// This `schema` is the one the subscription examples below use.
const schema = createSchema<{ signal: AbortSignal }>()({
	typeDefs: 'type Query { hello: String } type Subscription { tick: Int! }',
	resolvers: {
		Query: { hello: () => 'world' },
		Subscription: {
			tick: {
				subscribe: () => pubsub.subscribe('tick'),
				resolve: (n: number) => n,
			},
		},
	},
});

await pubsub.publish('tick', 1);
// Yoga's shape: `subscribe('post', id)`, `publish('post', id, payload)`, and
// `pipe(source, filter(keep), map(fn))` to wrap a subscription's source.
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

The upgrade's `Origin` is checked by default; list the browser origins that may connect in `csrf.sameOrigin.allowedOrigins`: see [Security](#security).

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

| import                 | what it is                                                                                                                                                                                                                                            |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@graxia/core`         | Server: `createGraxia`. Schema: `createSchema`. Plugins: `definePlugin`, `createStateKey`, `getRequestId`                                                                                                                                             |
|                        | PubSub: `createPubSub`, `pipe`, `filter`, `map`; types `PubSub`, `PubSubTopics`, `PubSubPayload`, `PubSubSubscribeArgs`, `Operator`, `MemoryPubSub`, `MemoryPubSubOptions`                                                                            |
|                        | Cache: `createMemoryCache`; types `KeyValueCache`, `CacheSetOptions`                                                                                                                                                                                  |
|                        | Context: `getContext`, `tryGetContext`                                                                                                                                                                                                                |
|                        | Errors: `exposedError`, `GraxiaError`, `isGraxiaError`, `GraxiaConfigError`, `GraxiaPluginError`, `GraxiaExecuteError`; plus the types of all of these                                                                                                |
|                        | Options: `SubscriptionsOptions`, `WebSocketOptions`, `WebSocketContext`, `IncrementalOptions`, `GraxiaSocketData`                                                                                                                                     |
|                        | Security: `DEFAULT_CSRF_HEADERS`; types `CsrfOptions`, `SameOriginOptions`, `CrossOrigin`                                                                                                                                                             |
|                        | Rate limits: `fieldRateLimit`, `memoryFieldLimit`, `limitFromStore`, `DEFAULT_LIMIT_CODE`; types `FieldRateLimitOptions`, `FieldLimit`, `FieldRule`, `FieldDecision`, `CostlessStore`, `MemoryFieldLimitOptions`                                      |
|                        | Limits: `costDirectives`, `computeOperationCost`, `DEFAULT_MAX_DEPTH`, `DEFAULT_MAX_ALIASES`, `DEFAULT_MAX_DIRECTIVES`, `DEFAULT_MAX_ROOT_FIELDS`, `DEFAULT_MAX_COST`, `DEFAULT_LIST_SIZE`; types `OperationLimits`, `CostOptions`, `ComputeCostArgs` |
|                        | Telemetry: types `TelemetryOptions` (the `telemetry` option) and `TelemetryInstance` (its `instance`, a `Telemetry` from `createTelemetry`); needs the optional peer `@softistx/telemetry`                                                            |
|                        | Trusted documents: types `TrustedDocumentsOptions`, `TrustedManifest`, `ApolloPersistedQueryManifest`                                                                                                                                                 |
| `@graxia/core/agent`   | `agentTypeDefs`, `agentDirectives`, `agentExtensions`, `needsOf`, `constraintOf`, `errorsOf`, `printSchemaFor`, `lintDescriptions`; types `Constraint`, `LintIssue`, `LintRule`                                                                       |
| `@graxia/core/testing` | `createTestClient` and `expectNoErrors`, for tests                                                                                                                                                                                                    |

## Documentation

- [Guides and index](./docs/README.md)
- [GraphQL over HTTP](./docs/guide/http.md): `createGraxia`, `fetch` / `serve`, status codes, batching, request id.
- [Plugins](./docs/guide/plugins.md): hooks, ordering, short-circuit, request state, typed context.
- [Context, cancellation and shutdown](./docs/guide/context.md): `InferContext`, the resolver context, `signal`, `getContext()`, `dispose()`.
- [Subscriptions](./docs/guide/subscriptions.md): server-sent events, keep-alive, cancellation, Bun idle timeout.
- [Subscriptions over WebSocket](./docs/guide/websocket.md): `graphql-transport-ws`, auth, close codes, own `Bun.serve`.
- [Ready for agents](./docs/guide/agent.md): `@graxia/core/agent`, directives, `printSchemaFor`, `lintDescriptions`, the `fix` contract.
- [Errors](./docs/guide/errors.md): `exposedError`, masking, correlation ids, `onUnexpected`.
- [Testing](./docs/guide/testing.md): `graxia.execute`, typed documents, the test client.
- [Codegen](./docs/guide/codegen.md): graphql-codegen's `Resolvers` with `createSchema`, `contextType`, mappers, `enumValues`.
- [Schema](./docs/guide/schema.md): `createSchema`, SDL, typed resolvers, codegen resolvers.
- [`@defer` and `@stream`](./docs/guide/incremental.md): multipart/mixed and SSE, formats, clients, masking.
- [PubSub](./docs/guide/pubsub.md): typed topics, the in-memory PubSub, filter and map helpers.
- [Limits and caches](./docs/guide/limits-and-caches.md): parse limits and the parse and validation caches.
- [Rate limiting](./docs/guide/rate-limiting.md): `fieldRateLimit`, stores, keys, `single` fields, 429 answers.
- [Security](./docs/guide/security.md): CSRF header, `sameOrigin`, WebSocket origin, introspection and suggestions.
- [Telemetry](./docs/guide/telemetry.md): spans, attributes, resolver spans, propagation, the optional peer.
- [Trusted documents](./docs/guide/trusted-documents.md): manifests, `documentId`, APQ, strict mode, error codes.
- [Production](./docs/guide/production.md): what `NODE_ENV=production` changes, a recommended configuration, proxies, shutdown, checklist.
- [Troubleshooting](./docs/troubleshooting.md): every error message, why it happens and the fix.
- [Roadmap](./docs/roadmap.md): what ships next.

## License

MIT
