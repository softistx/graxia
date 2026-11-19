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
Every error graxia itself emits carries one too (see [Ready for agents](./agent.md#the-fix-contract)). `fix` is one short sentence telling the client how to recover; `extensions` carries anything else
(`code` and `fix` win over the same names). `isGraxiaError(value)` tells an error made by
`exposedError` from any other value.

What is exposed as is, and what is masked:

| what the resolver threw, or what failed                                 | the client gets                                              |
| ----------------------------------------------------------------------- | ------------------------------------------------------------ |
| `exposedError(...)`                                                     | message, `code`, `fix`, `extensions`                         |
| a `GraphQLError` of your own (see the trap below)                       | message and extensions, as is                                |
| graphql's own errors: validation, variable coercion, non-null violation | unchanged                                                    |
| a plain `Error`, a thrown string, a library error                       | `Unexpected error.`, `INTERNAL_SERVER_ERROR`, correlation id |

The rule, exactly: an error is **exposed** when it has no `originalError` (graphql's own: validation,
coercion), when it is a genuine non-null violation, or when its original is a `GraphQLError` of any
origin (`exposedError` included). Everything else (a plain `Error`, a thrown string, a library error)
is **masked**. `path` and `locations` are always kept. `originalError` and stacks are never serialized.

## Validation errors

A document that parses but does not validate against the schema answers with graphql's own
errors (exposed), each carrying `extensions.code: "GRAPHQL_VALIDATION_FAILED"` (Apollo
compatible). The HTTP status is unchanged (400 with `application/graphql-response+json`, 200 with
`application/json`). Errors that a plugin supplies with `setResult` keep what the plugin gave them.

## Typed codes

`code` is typed as a key of `GraxiaErrorCodes`: `BAD_USER_INPUT`, `UNAUTHENTICATED`, `FORBIDDEN`,
`NOT_FOUND`, `CONFLICT`, `INTERNAL_SERVER_ERROR`, and the codes core itself emits
(`GRAPHQL_PARSE_FAILED`, `GRAPHQL_VALIDATION_FAILED`, `OPERATION_ABORTED`, `SHUTTING_DOWN`,
`SUBSCRIPTION_NOT_SUPPORTED`, `INCREMENTAL_NOT_SUPPORTED`). A code that is not in the list fails to
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
[troubleshooting](../troubleshooting.md#unexpected-error)).

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
