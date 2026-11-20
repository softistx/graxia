# Errors

A client sees two kinds of errors. **Exposed** errors are the ones you chose to show: their message,
`extensions.code` and `extensions.fix` reach the response. Everything else is **masked**: the client
gets `Unexpected error.` and a correlation id, and you get the original error through `onUnexpected`.
Masking is always on, in every environment.

## Exposed errors

```ts
import { exposedError } from '@graxia/core';

const resolvers = {
	Query: {
		book: (_parent, { id }, { books }) => {
			const book = books.get(id);
			if (!book)
				throw exposedError('NOT_FOUND', 'Book not found.', {
					fix: 'Check the id.',
					extensions: { id },
				});
			return book;
		},
	},
};
```

The response error is `{ message: "Book not found.", path, locations, extensions: { id, code: "NOT_FOUND", fix: "Check the id." } }`.
Every error graxia itself emits carries one too (see [The `fix` contract](#the-fix-contract)). `fix` is one short sentence telling the client how to recover; `extensions` carries anything else
(`code` and `fix` win over the same names). `isGraxiaError(value)` tells an error made by
`exposedError` from any other value.

What is exposed as is, and what is masked:

| what the resolver threw, or what failed                                 | the client gets                                              |
| ----------------------------------------------------------------------- | ------------------------------------------------------------ |
| `exposedError(...)`                                                     | message, `code`, `fix`, `extensions`                         |
| a `GraphQLError` of your own (see the trap below)                       | message and extensions, as is                                |
| graphql's own errors: validation, variable coercion, non-null violation | unchanged                                                    |
| a plain `Error`, a thrown string, a library error                       | `Unexpected error.`, `INTERNAL_SERVER_ERROR`, correlation id |

The same decision applies to an error thrown by a subscription's source iterator while it iterates
(after its first event): a `GraphQLError` reaches the client as is, a plain `Error` is masked and
reported through `onUnexpected`. A `GraphQLError` wrapping a plain `originalError` and thrown from the
iterator is masked (stricter than a resolver, where graphql locates and exposes it).
`onResultChunk` sees this failure as a chunk with `errors` and no `data` key.

The rule, exactly: an error is **exposed** when it has no `originalError` (graphql's own: validation,
coercion), when it is a genuine non-null violation, or when its original is a `GraphQLError` of any
origin (`exposedError` included). Everything else (a plain `Error`, a thrown string, a library error)
is **masked**. `path` and `locations` are always kept. `originalError` and stacks are never serialized.

## Status and headers from errors

Like GraphQL Yoga, a single operation answered as plain JSON (`application/json` or
`application/graphql-response+json`) takes its HTTP status and headers from the `extensions.http` of
its errors (the `ErrorHttp` type: `status`, `headers`, `spec`). `http` is removed from the
serialized extensions of every transport.

```ts
import { type ErrorHttp, exposedError } from '@graxia/core';

throw exposedError('CONFLICT', 'Email taken.', {
	fix: 'Sign in instead.',
	extensions: {
		http: {
			status: 409,
			headers: { 'x-reason': 'duplicate' },
		} satisfies ErrorHttp,
	},
});
// HTTP 409, `x-reason: duplicate`, `data` kept; the error's extensions are { code, fix }
```

- The **highest** `http.status` (an integer from 200 to 599) among the errors wins; `http.headers`
  of all the errors are merged, a later error winning on a clash. Other values are ignored.
- Precedence of the status: an operation-level answer (a rate limit's 429, a plugin refusal) wins,
  then the errors' status, then the media type's rule ([Status codes](./http.md#status-codes)).
- Precedence of the headers: what the plugins and the response already set (CORS, `cache-control`,
  `retry-after` of a refusal) wins; an error's header is added only when absent. An error cannot set
  `content-length`, `content-encoding`, `transfer-encoding`, `connection`, `content-type`,
  `keep-alive`, `upgrade`, `te` or `trailer`; they are dropped.
- Under `application/json`, the error's `extensions.http.spec` set to `true` ignores its status (its headers still apply), as in Yoga.
- Read from the **masked** result: a masked unexpected error carries nothing, so a plain `Error`
  cannot choose a status. A `maskError` that puts `http` on the error it returns does.
- Not copied from Yoga: a result-level `extensions.http`; the 500 for an unexpected error without
  data (graxia masks it and keeps the media type's rule); a status outside 200 to 599 (ignored);
  and the status and headers on the other transports. A batch (always 200), SSE, WebSocket and
  `multipart/mixed` keep their own status, but `http` is stripped from their payloads too.
- Stripping happens on the HTTP and WebSocket output only: `graxia.execute` and the telemetry still see `http`.
- `createGraxia({ errorHttp: false })` turns it all off: the media type decides and `extensions` are untouched.

## Validation errors

A document that parses but does not validate against the schema answers with graphql's own
errors (exposed), each carrying `extensions.code: "GRAPHQL_VALIDATION_FAILED"` (Apollo
compatible). The HTTP status is unchanged (400 with `application/graphql-response+json`, 200 with
`application/json`). Errors that a plugin supplies with `setResult` keep what the plugin gave them.

## Variable and operation-name errors

A variable that is missing or has the wrong type is refused by graphql before any field runs: the
answer has graphql's message, `extensions.code: "BAD_USER_INPUT"` and a `fix`. An error that
already has a code (an `exposedError` thrown by a custom scalar) keeps it. An operation name the
document does not have, or a missing one when the document holds several operations, is refused by
graxia with the same code and a `fix` that says to send `operationName`.

## Parse errors with their own code

A parse function (a plugin's `setParseFn`) that throws a `GraphQLError` with its own string `extensions.code` is
answered as written, with that code; other parse errors get `GRAPHQL_PARSE_FAILED`.

## Typed codes

`code` is typed as a key of `GraxiaErrorCodes`: `BAD_USER_INPUT`, `UNAUTHENTICATED`, `FORBIDDEN`,
`NOT_FOUND`, `CONFLICT`, `INTERNAL_SERVER_ERROR`, and the codes core itself emits
(`GRAPHQL_PARSE_FAILED`, `GRAPHQL_VALIDATION_FAILED`, `OPERATION_ABORTED`, `SHUTTING_DOWN`,
`SUBSCRIPTION_NOT_SUPPORTED`, `INCREMENTAL_NOT_SUPPORTED`, and the request refusals of
[GraphQL over HTTP](./http.md#refusal-codes)). A code that is not in the list fails to
compile. Add your own by augmenting the interface:

```ts
// graxia.d.ts
declare module '@graxia/core' {
	interface GraxiaErrorCodes {
		PAYMENT_REQUIRED: true;
	}
}

exposedError('PAYMENT_REQUIRED', 'Your plan has ended.', {
	fix: 'Renew it in the billing page.',
});
```

## Correlation id

The correlation id is the request id: the `x-request-id` header graxia generates (a client's own
header is never trusted). A masked error and the generic 500 both carry it:

```json
{
	"errors": [
		{
			"message": "Unexpected error.",
			"path": ["book"],
			"extensions": {
				"code": "INTERNAL_SERVER_ERROR",
				"correlationId": "5c1b…"
			}
		}
	]
}
```

A user who reports the id lets you find the original error in your logs (see
[troubleshooting](../troubleshooting-plugins.md#unexpected-error)).

## `onUnexpected`

`onUnexpected(error, { requestId, correlationId, phase })` receives the original, unmasked error of
every unexpected failure. `requestId` and `correlationId` are the same value; `phase` is `request`
(transport and `onRequest`-level failures), `execution` (a hook, `context` or `execute` failing inside an operation, or a resolver that threw) or
`dispose` (operations left after shutdown, which have no id) or `setup` (a plugin's `setup`
failed; reported once, with no id; see [Plugins](./plugins.md#setup-and-dispose)).

```ts
createGraxia({
	schema,
	onUnexpected: (error, { correlationId, phase }) =>
		logger.error({ err: error, correlationId, phase }),
});
```

By default it logs with `console.error` outside production; in production nothing is logged until you
set it. `false` silences it. An exception thrown by the reporter is swallowed.

## `maskError`

`maskError` replaces the default masker, for the last row of the table only (the unexpected errors).
It receives the error graphql built (with `path`, `nodes`) and the correlation id, and returns the
`GraphQLError` the client gets. The original is still reported through `onUnexpected`.

```ts
import { GraphQLError } from 'graphql';

createGraxia({
	schema,
	maskError: (error, { correlationId }) =>
		new GraphQLError('Something went wrong.', {
			path: error.path ?? [],
			extensions: { code: 'INTERNAL_SERVER_ERROR', reference: correlationId },
		}),
});
```

`maskErrors: false` turns masking off: every resolver error reaches the client with its message.
It is unsafe and meant for tests only.

A `maskError` that throws is replaced by the default masker for that error: the client still gets a
masked error, and both the original and the masker's own error reach `onUnexpected`.

## The `GraphQLError` trap

A plain `GraphQLError` thrown from a resolver is **exposed**, not masked (this matches GraphQL Yoga
and eases migration). A library that throws `GraphQLError` with internal details would therefore
leak them. Throw `exposedError` for errors you mean to show, and never put secrets in the message of
a `GraphQLError`. If a dependency throws `GraphQLError` you cannot trust, catch it and rethrow.

Any `GraphQLError` is exposed by design, including one that comes from an upstream client or a
gateway you call: its message and extensions reach your clients. Catch and rethrow such errors as
`exposedError` (or let a plain `Error` be masked).

## Known behaviour: scalar coercion

graphql itself reports a custom scalar's `parseValue` or `parseLiteral` that throws a plain `Error`
as a coercion error with that message, before any resolver runs. Graxia does not mask it (it has no
`originalError` it can tell from a client's mistake). From a scalar, throw
`exposedError('BAD_USER_INPUT', 'Invalid date.')` or a `GraphQLError` with a safe message, never a
message that names internals.

## The `fix` contract

Every error graxia itself emits carries `extensions.fix`, one short sentence saying what the client
changes, in development and in production. Messages and codes do not depend on it.

| the error                                                                                                       | the `fix` says                                                                |
| --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| a syntax error, a document over the token or depth limit                                                        | correct the document at the position the error points to                      |
| a validation failure (unknown field, a limit, introspection off)                                                | change the operation to match the schema                                      |
| a variable that is missing or invalid (`BAD_USER_INPUT`, raised before any field)                               | check the operation against the schema                                        |
| an unknown or missing operation name (`BAD_USER_INPUT`)                                                         | send `operationName`, naming one operation of the document                    |
| an HTTP refusal: 404, 405, 406, 413, 415, invalid JSON or parameters, a batch over its limit, CSRF and `Origin` | what to send instead (a header, a smaller body, one operation)                |
| a subscription over plain JSON, `@defer` or `@stream` over a transport that cannot stream                       | which transport or `Accept` to use, or to remove the directive                |
| trusted documents and APQ refusals, a rate limit, a field selected twice, a shutdown, an aborted operation      | the id or hash to send, when to retry, what to remove                         |
| a null in a non-null field                                                                                      | report it with the request id (a server bug)                                  |
| a masked unexpected error (`INTERNAL_SERVER_ERROR`)                                                             | "Retry later; quote the correlationId when you report it." It never says why. |

What graxia never touches: an error you throw. An `exposedError` carries the `fix` you give it (write one, so an
agent can recover), and a `GraphQLError` of your own, including one a `subscribe` threw or an error in a deferred
payload, stays as you wrote it. A validation rule's own `code` and extensions are kept; only a missing `fix` is
added. Errors of a plugin's own executor (a replaced `executeFn`) are the plugin's. See
[Ready for agents](./agent.md) for how an agent reads them, and `lintDescriptions` for the `@errors` codes.
