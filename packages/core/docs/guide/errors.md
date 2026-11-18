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
`fix` is one short sentence telling the client how to recover; `extensions` carries anything else
(`code` and `fix` win over the same names). `isGraxiaError(value)` tells an error made by
`exposedError` from any other value.

What is exposed as is, and what is masked:

| what the resolver threw, or what failed                                 | the client gets                                              |
| ----------------------------------------------------------------------- | ------------------------------------------------------------ |
| `exposedError(...)`                                                     | message, `code`, `fix`, `extensions`                         |
| a `GraphQLError` of your own (see the trap below)                       | message and extensions, as is                                |
| graphql's own errors: validation, variable coercion, non-null violation | unchanged                                                    |
| a plain `Error`, a thrown string, a library error                       | `Unexpected error.`, `INTERNAL_SERVER_ERROR`, correlation id |

`path` and `locations` are always kept. `originalError` and stacks are never serialized.

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
(a hook or the transport failed), `execution` (a resolver threw, or `execute` or `context` failed) or
`dispose` (operations left after shutdown, which have no id).

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

## The `GraphQLError` trap

A plain `GraphQLError` thrown from a resolver is **exposed**, not masked (this matches GraphQL Yoga
and eases migration). A library that throws `GraphQLError` with internal details would therefore
leak them. Throw `exposedError` for errors you mean to show, and never put secrets in the message of
a `GraphQLError`. If a dependency throws `GraphQLError` you cannot trust, catch it and rethrow.
