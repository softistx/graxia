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

const timing = definePlugin()({
	name: 'timing',
	onRequest: () => {
		const start = performance.now();
		return () => console.log(`took ${performance.now() - start}ms`);
	},
});

createGraxia({ schema, plugins: [timing] });
```

See [Plugins](./docs/guide/plugins.md).

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

Here `graxia` is the instance from the quick start. Documents are parsed under token and nesting limits, and parsed and validated documents are
cached. Both are options. These limits bound parsing and the body, not what an operation costs
to execute: see [Security in 0.1.0](#security-in-010).

```ts
createGraxia({
	schema,
	limits: { tokens: 15_000, nesting: 1_000, bodyBytes: 1_048_576 },
	caches: { parse: { max: 1024, ttlMs: 3_600_000 } }, // or `false`
	batching: { limit: 10 }, // off by default
});
```

See [Limits and caches](./docs/guide/limits-and-caches.md).

## Security in 0.1.0

0.1.0 is a transport and plugin engine, not a hardened edge. What it does, and what it does not:

**On by default**

- Error masking: a resolver error that is not an `exposedError` or a `GraphQLError` reaches the
  client as `Unexpected error.` with a correlation id; the original goes to `onUnexpected`.
- A request body limit (`limits.bodyBytes`, 1 MiB; more answers 413).
- Document limits before parsing: at most 15 000 tokens and 1 000 nesting levels
  (`limits.tokens`, `limits.nesting`); a failure is `GRAPHQL_PARSE_FAILED`.
- Batching is off unless you set `batching: { limit }`.
- A client's `x-request-id` is never trusted or echoed; graxia generates the id.

**Not in 0.1.0**

- CSRF prevention: a browser can send a simple cross-site `GET` or a form-encoded request to
  the endpoint with the user's cookies. graxia does not check `Origin` or require a preflight header.
- Introspection control: introspection is always on.
- Operation limits: no depth, alias, directive or complexity limit, and no field rate limit.
- Trusted or persisted documents: any valid document runs.

These are planned (see the [roadmap](./docs/roadmap.md)). Until they land:

- Put the endpoint behind a proxy or gateway that rate-limits and caps request cost, and do not
  expose it to browsers with cookie auth without your own CSRF check.
- Add a plugin whose `onRequest` refuses requests that lack a header a browser cannot send
  cross-site without a preflight:

```ts
import { definePlugin } from '@graxia/core';

const requireCustomHeader = definePlugin()({
	name: 'require-custom-header',
	onRequest: ({ request, respond }) => {
		if (!request.headers.has('x-requested-with'))
			respond(new Response('Missing x-requested-with', { status: 403 }));
	},
});
```

- Add a validation rule with `onValidate` (`addRule`) to reject introspection or deep documents
  in production.

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

const client = createTestClient(graxia, { headers: { 'x-user': 'ada' } });
const result = await client.query<{ me: string }>('{ me }');
expectNoErrors(result);
result.status; // 200
result.data?.me; // 'ada'
```

## Exports

| import                 | what it is                                                                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@graxia/core`         | Server: `createGraxia`. Schema: `createSchema`. Plugins: `definePlugin`, `createStateKey`, `getRequestId`                                              |
|                        | Context: `getContext`, `tryGetContext`                                                                                                                 |
|                        | Errors: `exposedError`, `GraxiaError`, `isGraxiaError`, `GraxiaConfigError`, `GraxiaPluginError`, `GraxiaExecuteError`; plus the types of all of these |
| `@graxia/core/testing` | `createTestClient` and `expectNoErrors`, for tests                                                                                                     |

## Documentation

- [Guides and index](./docs/README.md)
- [GraphQL over HTTP](./docs/guide/http.md): `createGraxia`, `fetch` / `serve`, status codes, batching, request id.
- [Plugins](./docs/guide/plugins.md): hooks, ordering, short-circuit, request state, typed context.
- [Context, cancellation and shutdown](./docs/guide/context.md): `getContext()`, `signal`, `dispose()`.
- [Errors](./docs/guide/errors.md): `exposedError`, masking, correlation ids, `onUnexpected`.
- [Testing](./docs/guide/testing.md): `graxia.execute`, typed documents, the test client.
- [Schema](./docs/guide/schema.md): `createSchema`, SDL, typed resolvers, codegen resolvers.
- [Limits and caches](./docs/guide/limits-and-caches.md): parse limits and the parse and validation caches.
- [Troubleshooting](./docs/troubleshooting.md): every error message, why it happens and the fix.
- [Roadmap](./docs/roadmap.md): what ships next.

## License

MIT
