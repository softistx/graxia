# Rate limiting fields

`fieldRateLimit` limits how often a client may select chosen fields, counted across aliases and
fragments. It is a plugin: nothing changes until you add it.

## Why per field

A request limiter counts requests. GraphQL lets one request ask for a field many times:

```graphql
{
	a: signIn(email: "x", password: "1")
	b: signIn(email: "x", password: "2")
	c: signIn(email: "x", password: "3")
}
```

That is one request and three password guesses. `fieldRateLimit` counts selections: this document
spends 3 units on `signIn`, whatever the aliases and fragments around it.

## Quick start

```ts
import { createGraxia, fieldRateLimit, memoryFieldLimit } from '@graxia/core';

const graxia = createGraxia({
	schema,
	plugins: [
		fieldRateLimit({
			fields: {
				signIn: {
					limit: memoryFieldLimit({ limit: 5, windowMs: 60_000 }),
					single: true,
				},
				sendInvite: memoryFieldLimit({ limit: 20, windowMs: 3_600_000 }),
			},
		}),
	],
});
```

Past a limit nothing executes and the client gets a `429`:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 42
Cache-Control: no-store

{"errors":[{"message":"Too many requests, try again later.","extensions":{"code":"RATE_LIMITED","retryAfter":42}}]}
```

## Options

| option       | what it does                                                                                                     |
| ------------ | ---------------------------------------------------------------------------------------------------------------- |
| `fields`     | Required. Field name to a limit, or to `{ limit, single? }`. A name matches on any type, at any depth.           |
| `key`        | `(ctx) => string \| undefined`, who is counted. Default: the client address (below). `undefined` counts nothing. |
| `ipv6Prefix` | An integer 0 to 128. An IPv6 client is counted by its network. Default key only.                                 |
| `code`       | The `extensions.code` of a refusal. `RATE_LIMITED` by default (`DEFAULT_LIMIT_CODE`).                            |

A limit is any object with `consume(key, cost)` returning `{ allowed, retryAfter }` (milliseconds),
sync or async. The key passed to it is `<fieldName>:<who>`.

## What is counted

- Each selection of a limited field, as written in the document, fragments expanded: a fragment
  spread twice counts twice. The walk is memoised, so a document of exponential fragments is
  still read in linear time (S14's operation limits refuse it anyway).
- A field is matched by name only, on any type. A list parent costs 1.
- `@skip` and `@include` are not evaluated: a skipped field still counts.
- Introspection subtrees are ignored. Only the operation that will run (`operationName`) is counted.
- Queries and mutations are counted before they execute; a subscription is counted once, when it
  starts, not per event.

## `single`: one selection per operation

`{ limit, single: true }` also refuses an operation that selects the field at two different
places (aliases, other arguments, other parents) with a `400`, code `FIELD_SELECTED_ONCE`:
`signIn may be selected once per operation.` Nothing is spent on a refusal. The same field written
identically twice under the same parents is one place and passes, at a cost of 2 units.

## Who is counted

By default the key is `ctx.ip` when the operation context has a string `ip`, else the address
`graxia.serve()` read from the connection (`server.requestIP`). It is recorded for WebSocket
operations too, from the upgrade request.

- With `fetch()` (your own `Bun.serve`) or `graxia.execute()` there is no address: nothing is counted
  until you give `key` or put `ip` in the context. Do it from your `Bun.serve` handler.
- **Behind a proxy** the connection address is the proxy's. Give `key` from a header only your
  proxy sets:

```ts
fieldRateLimit({
	fields,
	key: (ctx: { request: Request }) =>
		ctx.request.headers.get('x-real-ip') ?? undefined,
});
```

Put `request` in the context (`context: ({ request }) => ({ request })`) or use `ip`.

- `ipv6Prefix: 64` counts a client by its `/64`, since one subscriber often holds a whole network.
  The key is `<8 hex groups>/<prefix>`. IPv4 addresses are unchanged. It is refused together with
  `key`: reduce the address in your own function.

## Stores

- `memoryFieldLimit({ limit, windowMs })`: fixed window per key, in this process, up to `maxKeys`
  keys (10 000; expired entries go first, then the oldest). For development, tests and one server.
  A call over the units left is refused and spends nothing. `now` sets the clock for tests.
- `limitFromStore(store, policy?)`: wraps a store that counts one request per call. A cost of 3 is
  three `store.consume(key, { limit, windowMs })` calls, stopped at the first refusal. The policy
  comes from `store.policy`, from `policy`, or both when they agree.
- Your own: shared state across servers belongs in Redis. Wrap your limiter:

```ts
import type { FieldLimit } from '@graxia/core';

const redisLimit = (limit: number, windowMs: number): FieldLimit => ({
	async consume(key, cost) {
		const used = await redis.incrby(`rl:${key}`, cost);
		if (used === cost) await redis.pexpire(`rl:${key}`, windowMs);
		if (used <= limit) return { allowed: true, retryAfter: 0 };
		return { allowed: false, retryAfter: await redis.pttl(`rl:${key}`) };
	},
});
```

## Refusals per transport

| transport        | refusal                                                                                   |
| ---------------- | ----------------------------------------------------------------------------------------- |
| HTTP (JSON)      | `429`, `Retry-After` (seconds, at least 1), `Cache-Control: no-store`; `400` for `single` |
| a batch          | that entry is the error; the batch stays `200`, no header                                 |
| SSE              | the error as a `next` event, then `complete`; no status, no header                        |
| WebSocket        | an `error` message for the subscribe                                                      |
| `graxia.execute` | a result with the error                                                                   |

`extensions.retryAfter` is the same number of seconds as the header.

## Charging order

Fields are charged in the order the document first selects them. Units spent before a refusal stay
spent, on that field's earlier selections and on the fields charged before it. A `single` refusal
happens before anything is charged. If a store throws, the operation fails as an unexpected error
(a `500`), it does not run.

## Placement

The plugin is `enforce: 'pre'`: it runs before other plugins' `onExecute` / `onSubscribe` hooks,
so a plugin that swaps the executor later cannot skip the count. List it first among the `pre`
plugins. Rate limiting every request, not only fields, belongs in front of graxia (a proxy or
gateway).
