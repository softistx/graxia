# Testing

Two tools, no socket: `graxia.execute` runs an operation in process, and `@graxia/core/testing`
talks to `graxia.fetch` with real HTTP semantics. Neither imports `bun:test`; use any runner.

The examples share this setup:

```ts
import { createGraxia, createSchema } from '@graxia/core';

const schema = createSchema()({
	typeDefs:
		'type Query { hello: String greet(name: String!): String } type Mutation { bump: Int }',
	resolvers: {
		Query: {
			hello: () => 'world',
			greet: (_root, args) => `hi ${String(args.name)}`,
		},
		Mutation: { bump: () => 1 },
	},
});
const graxia = createGraxia({ schema });
```

## `graxia.execute`

For tests, server-side jobs and anything that has no HTTP request. It builds a synthetic
`POST http://graxia.local/graphql` request and runs the same pipeline as HTTP: every plugin hook
(`onRequest` sees that request), `context`, `getContext()`, the request id, `dispose` tracking and
error masking. It skips only content negotiation and HTTP encoding, and returns the masked result
object.

```ts
const { data, errors } = await graxia.execute({
	document: 'query Greet($name: String!) { greet(name: $name) }',
	variables: { name: 'Ada' },
	operationName: 'Greet', // when the document has several operations
	headers: { authorization: 'Bearer test' }, // seen by onRequest and context()
	serverContext: {}, // merged into the context, as in fetch(request, serverContext)
	signal: AbortSignal.timeout(5_000), // aborts like a client leaving
});
```

`document` is a string (through the parse cache), a `DocumentNode` (parse is skipped; `onParse`
still runs) or a typed document.

### Typed documents

`TypedDocument<Result, Variables>` is structurally compatible with codegen's `TypedDocumentNode`
(`@graphql-typed-document-node/core`) and with graphql's `TypedQueryDocumentNode`; `TypedString`
is the string form codegen's `documentMode: string` emits. No dependency is added. The result and
the variables are inferred, and wrong variables fail to compile:

```ts
import type { TypedDocument } from '@graxia/core';
import { parse } from 'graphql';

const Hello = parse('{ hello }') as TypedDocument<
	{ hello: string },
	{ id: string }
>;
const result = await graxia.execute({
	document: Hello,
	variables: { id: '1' },
});
result.data?.hello; // string
// graxia.execute({ document: Hello, variables: { id: 1 } }); // type error
```

### What it does not do

- Subscriptions and `@defer` / `@stream` return their usual refusal error in the result
  (`SUBSCRIPTION_NOT_SUPPORTED`, `INCREMENTAL_NOT_SUPPORTED`); `execute` does not throw for them.
- When the request ends without a result, `execute` rejects with a `GraxiaExecuteError` carrying
  `response`, the HTTP response the pipeline produced: a plugin answered with `respond(...)`, a hook
  failed unexpectedly (500), or the instance was disposed (503, `SHUTTING_DOWN`).

```ts
import { GraxiaExecuteError } from '@graxia/core';

try {
	await graxia.execute({ document: '{ hello }' });
} catch (error) {
	if (error instanceof GraxiaExecuteError)
		console.log(error.status, await error.response.text());
}
```

## The test client

`createTestClient(graxia, { path?, headers?, serverContext? })` sends requests through
`graxia.fetch`, so status codes, negotiation, GET encoding and batching behave as over HTTP.

```ts
import { createTestClient, expectNoErrors } from '@graxia/core/testing';

const client = createTestClient(graxia, { headers: { 'x-tenant': 'acme' } });

const result = await client.query<{ hello: string }>('{ hello }');
expectNoErrors(result); // throws "Expected no GraphQL errors, got 1: - message [CODE] at path"
result.status; // 200
result.data?.hello; // 'world'
result.body; // the parsed JSON
result.headers; // Headers
result.response; // the raw Response (body already read)
```

Every result is `{ status, headers, body, data, errors, extensions, response }`; `data` is `null`
when execution failed and `undefined` when the request was refused before it.

### Methods, status codes and `Accept`

```ts
await client.query('{ hello }', { method: 'GET' }); // query string: query, variables, operationName, extensions
await client.mutate('mutation { bump }'); // POST only
(await client.query('mutation { bump }', { method: 'GET' })).status; // 405, allow: POST
(await client.query('{ hello')).status; // 400, a syntax error
(await client.query('{ hello }', { accept: 'text/html' })).status; // 406
await client.query('{ hello', { accept: 'application/json' }); // legacy media type: 200 with errors
```

`headers` merge in this order: the client's, then the request's (which win). The default `Accept`
is `application/graphql-response+json, application/json`.

### Persisted queries

`persisted: true` sends the automatic-persisted-queries form: the query plus
`extensions: { persistedQuery: { version: 1, sha256Hash } }`, with the hash (lowercase hex SHA-256)
computed from the document text. `{ sha256Hash }` sends a hash you provide; pass `null` as the
document to omit the query text.

```ts
await client.query('{ hello }', { persisted: true });
await client.query(null, { persisted: { sha256Hash: 'ecf4…' } });
```

The server side (trusted documents, APQ errors) arrives with the trusted-documents slice; until
then a hash alone answers `Must provide a query string.` (400).

### Batching

With `batching: { limit }` on the instance, `client.batch` sends a JSON array and returns
`{ status, headers, body, results, response }`, one `{ data, errors, extensions }` per entry:

```ts
const batched = createTestClient(
	createGraxia({ schema, batching: { limit: 10 } }),
);
const { results } = await batched.batch([
	{ document: '{ hello }' },
	{ document: '{ hello }' },
]);
```

Without batching the answer is a 400 and `results` is empty.
