# @graxia/core

The Bun-native GraphQL server engine: typed plugins, graphql 17, GraphQL over HTTP, with no
adapter layer. Pass a schema, get a `fetch` handler that follows the
[GraphQL over HTTP](https://graphql.github.io/graphql-over-http/) spec (it passes every
`graphql-http` server audit).

> Pre-1.0: the API is settling. Expect minor versions to change it, with the change in the
> changelog; pin a minor until 1.0.

## Requirements

- [Bun](https://bun.sh) 1.4.4 or later (the `engines` field). No Node or Deno adapter.
- `graphql` `^17.0.0`, as a peer dependency.
- `typescript` is an optional peer, for types. Use `"moduleResolution": "bundler"` in your
  `tsconfig.json`; `nodenext` is not supported.

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
hook runs it after the stage.

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

Documents are parsed under token and nesting limits, and parsed and validated documents are
cached. Both are options; the defaults are safe.

```ts
createGraxia({
	schema,
	limits: { tokens: 15_000, nesting: 1_000, bodyBytes: 1_048_576 },
	caches: { parse: { max: 1024, ttlMs: 3_600_000 } }, // or `false`
	batching: { limit: 10 }, // off by default
});
```

See [Limits and caches](./docs/guide/limits-and-caches.md).

## `execute`

Run an operation in process, through the same pipeline as HTTP (plugins, context, masking), for
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

`@graxia/core/testing` sends requests through `graxia.fetch` with real HTTP semantics, without a
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

| import                 | what it is                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------- |
| `@graxia/core`         | `createGraxia`, `createSchema`, `definePlugin`, `exposedError`, `getContext`, `createDocumentPipeline`, types |
| `@graxia/core/testing` | `createTestClient` and `expectNoErrors`, for tests                                                            |

## Documentation

- [Guides and index](./docs/README.md)
- [GraphQL over HTTP](./docs/guide/http.md): `createGraxia`, `fetch` / `serve`, status codes, batching, request id.
- [Plugins](./docs/guide/plugins.md): hooks, ordering, short-circuit, request state, typed context.
- [Context, cancellation and shutdown](./docs/guide/context.md): `getContext()`, `signal`, `dispose()`.
- [Errors](./docs/guide/errors.md): `exposedError`, masking, correlation ids, `onUnexpected`.
- [Testing](./docs/guide/testing.md): `graxia.execute`, typed documents, the test client.
- [Schema](./docs/guide/schema.md): `createSchema`, SDL, typed resolvers, codegen resolvers.
- [Limits and caches](./docs/guide/limits-and-caches.md): parse limits, caches, `createDocumentPipeline`.
- [Troubleshooting](./docs/troubleshooting.md): every error message, why it happens and the fix.
- [Roadmap](./docs/roadmap.md): what ships next.

## License

MIT
