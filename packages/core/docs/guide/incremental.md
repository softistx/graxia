# `@defer` and `@stream`

Incremental delivery sends the parts of a result as they become ready: a query with `@defer` or
`@stream` answers a first payload at once, then more payloads until `hasNext` is `false`. It is on by
default for queries and mutations, over `multipart/mixed` and over server-sent events.

```ts
import { createGraxia, createSchema } from '@graxia/core';

const schema = createSchema()({
	typeDefs:
		'type Query { user: User friends: [String!]! } type User { name: String slow: String }',
	resolvers: {
		/* ... */
	},
});
const graxia = createGraxia({ schema }); // incremental delivery is on
```

`createSchema` adds the `@defer` and `@stream` directives to the schemas it builds (unless your SDL
declares them). A `GraphQLSchema` you build yourself needs them in its directives, or validation
answers `Unknown directive "@defer".`:

```ts
import {
	GraphQLDeferDirective,
	GraphQLSchema,
	GraphQLStreamDirective,
	specifiedDirectives,
} from 'graphql';

new GraphQLSchema({
	query,
	directives: [
		...specifiedDirectives,
		GraphQLDeferDirective,
		GraphQLStreamDirective,
	],
});
```

## Which `Accept` gets what

| `Accept`                                                             | answer                                                     |
| -------------------------------------------------------------------- | ---------------------------------------------------------- |
| `multipart/mixed` (with or without `deferSpec` / `subscriptionSpec`) | `multipart/mixed; boundary="-"`, one JSON part per payload |
| `text/event-stream`                                                  | one `next` event per payload, then `complete`              |
| `application/graphql-response+json`, `application/json`, `*/*`       | refused with `INCREMENTAL_NOT_SUPPORTED` (400 / 200)       |

`multipart/mixed` is chosen only when named (never through a wildcard). For an incremental operation
(`@defer`, `@stream`) it is used whenever it is named with a q above 0, even when a JSON type is listed
first or ranks higher, because clients that list JSON first, such as GraphiQL, send
`Accept: application/json, multipart/mixed`. `text/event-stream` is chosen
only when not ranked below a JSON type. Any other operation keeps the usual negotiation (JSON here). A query that does not turn out incremental, and any error before
execution (parse, validation), is answered as plain JSON even under a `multipart/mixed` `Accept`,
which clients such as Apollo Client read. A batch with either `Accept` answers 400.

The multipart framing is the one of the incremental delivery over HTTP specification: boundary `-`,
each part `\r\n---\r\ncontent-type: application/json; charset=utf-8\r\n\r\n<json>`, the response
ending with `\r\n-----\r\n`. There is no keep-alive part: a query is finite.

## Formats

```ts
createGraxia({ schema, incremental: { format: 'graphql17' } }); // the default
createGraxia({ schema, incremental: { format: 'legacy' } });
```

- `graphql17` is graphql 17's format: the initial result lists `pending` ids, each later payload has
  `incremental` entries and `completed` ids, and `hasNext`. Apollo Client 4 reads it
  (`GraphQL17Alpha9Handler`).
- `legacy` is the 2022-08 format (`incremental` entries with `path` and `label`, no ids), which older
  Apollo, urql and Relay clients read. graxia runs graphql's `legacyExecuteIncrementally`.
- `incremental: false` turns delivery off: an incremental result is released and the query is refused
  with `INCREMENTAL_NOT_SUPPORTED`. The executor is still graphql's `experimentalExecuteIncrementally`
  (graphql's plain `execute` throws for a schema that declares `@defer`); a query without `@defer` or
  `@stream` is answered as usual.

## A client

```ts
// bun add -d meros
import { meros } from 'meros';

const response = await fetch('http://localhost:3000/graphql', {
	method: 'POST',
	headers: {
		'content-type': 'application/json',
		accept: 'multipart/mixed;deferSpec=20220824, application/json',
	},
	body: JSON.stringify({ query: '{ user { name ... @defer { slow } } }' }),
});
const parts = await meros(response);
for await (const part of parts) console.log(part.body);
```

## Running the schema elsewhere

`createSchema` declares `@defer` and `@stream`, and graphql's plain `execute` refuses such a schema
(`The provided schema unexpectedly contains experimental directives (@defer or @stream). These directives may only be utilized if experimental execution features are explicitly enabled.`). Run it through graxia or `experimentalExecuteIncrementally`, or build it without the
directives when it only feeds plain `execute`:

```ts
createSchema()({ typeDefs, resolvers, incremental: false });
```

Such a schema cannot serve incremental queries.

## Hooks, masking, context

- `onResultChunk` runs for every payload, initial and subsequent, before masking; `setChunk` replaces
  it.
- Unexpected resolver errors are masked on every payload: the top-level `errors`, and the `errors` of
  each `incremental` and `completed` entry. The original reaches `onUnexpected` once, with the same
  correlation id.
- `onExecute` runs once, around the executor; its `setExecuteFn` may return graphql's incremental
  results (`{ initialResult, subsequentResults }`).
- `getContext()` works in deferred and streamed resolvers (`asyncContext`).

## Cancellation and shutdown

The stream is pulled one payload at a time. When the client leaves or cancels the body, the
operation's `signal` aborts and graxia calls `subsequentResults.return()`.

Over HTTP (multipart/mixed, SSE), `dispose()` lets an incremental query or mutation drain like any other operation: it keeps streaming
its deferred parts for up to `shutdownTimeout`. A stream still open after that is cut (a multipart
response gets its closing boundary, an event stream gets `complete`) and its resolvers see the
operation's `signal` abort. Only subscriptions end as soon as `dispose()` starts (see
[Subscriptions](./subscriptions.md)). Over WebSocket there is no drain: `dispose()` closes the
socket with 1001 and ends every operation on it.

## Limits

- Not over plain JSON, and not through `graxia.execute` or the test client (they return the
  `INCREMENTAL_NOT_SUPPORTED` error in the result).
- Not inside subscription events: a subscription event that uses `@defer` / `@stream` is refused with
  `INCREMENTAL_NOT_SUPPORTED`.
- Not in a batch.
