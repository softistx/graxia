# Telemetry

graxia emits spans for each request, parse, validation and operation, and optionally for each
resolver, on [`@softistx/telemetry`](https://www.npmjs.com/package/@softistx/telemetry). It is an
optional peer (a host that already spans the request can drop graxia's request and operation
spans with `operationSpans: false`): installed, tracing is on and costs what your telemetry costs; absent, graxia does
nothing and wraps nothing. The spans follow OpenTelemetry's GraphQL names and reach any OTLP
backend through `@softistx/telemetry-otlp`.

## Setup

Install the package and an exporter. Create and install one telemetry at startup, before
`createGraxia`.

```sh
bun add @softistx/telemetry @softistx/telemetry-otlp
```

```ts
import { createTelemetry } from '@softistx/telemetry';
import { otlpExporter } from '@softistx/telemetry-otlp';
import { createGraxia } from '@graxia/core';

const telemetry = createTelemetry('my-api', {
	exporters: [otlpExporter({ endpoint: 'http://localhost:4318' })],
}).install();

// graxia finds the installed telemetry, so the exporter above receives its spans.
const graxia = createGraxia({ schema });

// On shutdown, await it, or the last batch is lost.
process.on('SIGTERM', async () => {
	await graxia.dispose();
	await telemetry.close();
});
```

To keep the telemetry out of the global, pass it:
`createGraxia({ schema, telemetry: { instance: telemetry } })`. With none installed or passed, spans
are detached: nothing is emitted, and graxia skips the rest of the work for the request (no
attribute, no child span, no copy of the response). The span context travels in an
`AsyncLocalStorage`, so no context manager is needed.

## The span tree

```
graphql.request                      one per HTTP request on the GraphQL path
└── query GetUser                    one per operation (each batch entry, each subscribe)
    ├── graphql.parse
    ├── graphql.validate
    └── graphql.resolve user         optional, one per resolver call
```

`parse` and `validate` are children of the operation span: the operation span starts first and is
named once the operation is chosen (`query GetUser`, `mutation`, `subscription Ticks`; a document
that does not parse stays `graphql.operation`). A batch has one request span and one operation span
per entry, in order. `graxia.execute` goes through the same request, so it has both.

The operation span's name uses the `operationName` the client sent, which is unbounded in `mixed` trusted-documents mode (or with no trusted documents): a backend that indexes span names can see its cardinality explode. `strict` trusted documents bound it, since only your manifest's operations run.

## Attributes

| span                | attribute                                                                                                      |
| ------------------- | -------------------------------------------------------------------------------------------------------------- |
| `graphql.request`   | `http.request.method`, `graxia.request.id` (the `x-request-id`), `http.response.status_code`                   |
|                     | `graxia.refusal.code`: the code of a 4xx answer (`CSRF_HEADER_REQUIRED`, `RATE_LIMITED`, ...)                  |
|                     | `graxia.request.upgrade`: `1` on a WebSocket handshake                                                         |
| `graphql.operation` | `graphql.operation.type`, `graphql.operation.name` (when named), `graphql.error.count` (when there are some)   |
|                     | `graphql.document` (only with `document: true`), `graxia.document.id` (a persisted document or APQ hash)       |
|                     | `graxia.event.index` on each `graphql.event` span event (1, 2, ...)                                            |
|                     | `graxia.events` (subscriptions and incremental results: the payloads sent)                                     |
| `graphql.parse`     | `graxia.cache.hit` (the parse cache served it), `graphql.error.count`                                          |
| `graphql.validate`  | `graxia.cache.hit` (the validation cache served it), `graphql.error.count`                                     |
| `graphql.resolve x` | `graphql.field.name`, `graphql.field.path` (`user.posts.0.title`), `graphql.field.type`, `graphql.parent.type` |

Status: a span is `error` only for a failure of the server. The request span is `error` on a 5xx.
The operation span is `error`, with the original exception recorded, when a resolver threw an
unexpected error (the ones `onUnexpected` reports and the client sees masked), when a plugin hook
or the executor threw, or when a stream failed. A validation error, a 4xx refusal (CSRF, rate limit,
a persisted document that is not found) and an exposed `GraphQLError` are the client's: no `error`,
only `graphql.error.count` and `graxia.refusal.code`.

Spans are server-side: the **original** exception, with its real message and stack, is recorded
even though the client got a masked error. Treat your trace backend like your logs. A failure that is
an `AbortError` or a `TimeoutError` ends the span `cancelled`, not `error`: a shutdown or a timeout
is not a bug to page for.

## Request kind and propagation

With no active span, `graphql.request` is a `server` span and its parent is read from the request's
`traceparent` header (`propagate: false` skips it). When your host already has an active span
(graxia mounted in your own handler under an instrumented server), the request span is its
`internal` child and the header is not read again.

## Subscriptions, SSE and incremental delivery

- **SSE and `multipart/mixed`**: the request span stays open until the stream ends or the client
  cancels it, so its duration is the stream's.
- A subscription or `@defer`/`@stream` operation is one operation span from start to end of the
  stream. Each payload is a span event named `graphql.event`, never a span per event; `graxia.events`
  holds the count when it ends.
- **WebSocket**: the upgrade has a short `graphql.request` span (`GET`, `graxia.request.upgrade`,
  status 101 when it succeeded). There is no request span per message: each `subscribe` is its own
  operation span, a child of the upgrade's `graphql.request` span, so it is in the trace the upgrade
  request's `traceparent` header started.

## Resolver spans

```ts
createGraxia({
	schema,
	telemetry: { resolverSpans: true }, // or { trivial: true } to include fields with no resolver
});
```

One span per resolver call is expensive on a large list, hence the default (see Options). `true` traces the resolvers
you wrote. `{ trivial: true }` also traces the fields that read a property of their parent (graphql's
default resolver), which is usually noise. Each span is a child of the operation span (not of the
resolver that returned its parent), so the tree stays flat and cheap.

The resolvers are wrapped **once, in place, on the schema you give** (graphql 17 has no hook to trace
a field's own `resolve` from outside), when `createGraxia` runs with `resolverSpans`. The wrappers
stay on the schema for its lifetime: an execution that is not traced pays one `WeakMap` lookup per
field. Sharing the
schema with another graxia instance, or with `telemetry: false`, is safe: a wrapped resolver
traces only the operations of an instance that asked for it, and otherwise calls your resolver.

## The host already spans the operation

When your host (an instrumented server, a GraphQL layer such as `@alxia/graphql`) already makes a
span for the request and one for the operation, graxia's `graphql.request` and operation spans
are duplicates. Drop them and keep the rest:

```ts
createGraxia({ schema, telemetry: { operationSpans: false } });
```

With `operationSpans: false` and a span active when the request arrives (HTTP and WebSocket alike):

- there is no `graphql.request` span and no operation span;
- `graphql.parse`, `graphql.validate` and, with `resolverSpans`, `graphql.resolve x` are still made,
  children of the host's active span. A WebSocket message is handled outside the host's context, so
  graxia keeps the host's `traceparent` from the request (the upgrade, for a socket) and the socket's spans continue
  that trace, under the host's upgrade span;
- the host's span carries `graphql.operation.type`, `graphql.operation.name`, `graxia.document.id`,
  `graphql.error.count` and, with `document: true`, `graphql.document`. graxia only writes
  attributes on it (through `activeSpan()` of `@softistx/telemetry` 0.5): it never renames, fails or
  ends the host's span;
- the original exception behind each masked error is a failed `graphql.error` span, a child of the
  host's active span, unless a resolver span already recorded it; a timeout or abort makes none;
- `graxia.events` and the request's attributes (`http.*`, `graxia.refusal.code`) are not recorded.

This needs `@softistx/telemetry` 0.5 or later (`activeSpan()`).

**With no span active at the request there is nothing to duplicate.** graxia then makes its
`graphql.request` and operation spans as usual, and `propagate` keeps its meaning (the `traceparent`
header is read). A step span never starts a trace of its own.

This replaces `telemetry: false` for such a host, which also loses every step span.

## Active span

Execution runs inside the operation span, so `currentSpan()` from `@softistx/telemetry` in a
resolver is the operation span (or its resolver span with `resolverSpans`), and a `span()` you start
there nests under it, and logs written there carry its `traceId`. With `operationSpans: false` and a
host span active, it is the host's span instead.

## The document and PII

`graphql.document` is opt-in: a document can hold literals (an email, a token) that
variables would not. Turn on `document: true` only when your queries carry none, or use persisted
operations (`graxia.document.id` always identifies them).

## Without the peer

When `@softistx/telemetry` cannot be loaded, or `telemetry: false`, graxia creates no span object,
wraps no resolver and adds no work to a request. Passing `telemetry: { instance }` without the
package installed does the same.

## Options

```ts
telemetry?: false | {
	instance?: TelemetryInstance; // a Telemetry from createTelemetry (@softistx/telemetry)
	resolverSpans?: boolean | { trivial?: boolean };
	operationSpans?: boolean;
	document?: boolean;
	propagate?: boolean;
};
```

| option           | default                                        | meaning                                                                  |
| ---------------- | ---------------------------------------------- | ------------------------------------------------------------------------ |
| `telemetry`      | on when `@softistx/telemetry` is installed     | `false` turns every span off                                             |
| `instance`       | the telemetry in scope, else the installed one | the `Telemetry` the spans are emitted to                                 |
| `resolverSpans`  | `false`                                        | `true`: your resolvers; `{ trivial: true }`: fields with no resolver too |
| `operationSpans` | `true`                                         | `false`: no request or operation span, for a host that makes its own     |
| `document`       | `false`                                        | the document source on `graphql.document` (may hold literals)            |
| `propagate`      | `true`                                         | read the `traceparent` header of a request with no active span           |

## Migrating from `@opentelemetry/api`

Before 0.4 graxia traced through `@opentelemetry/api`. Now: `bun add @softistx/telemetry` (and an
exporter such as `@softistx/telemetry-otlp`) in place of the OpenTelemetry API and SDK packages,
`createTelemetry(...).install()` in place of the provider and context manager, and
`telemetry: { instance }` in place of `telemetry: { tracer }`. Span names and attributes are
unchanged. Differences:

- A failure that is a timeout or an abort is `cancelled` instead of `error`.
- A WebSocket operation span is now a child of the upgrade's `graphql.request` span.
- The operation span records the first unexpected error only; `graphql.error.count` still counts
  all of them.
- The `tracer` option is not ignored: it throws, see
  [Troubleshooting](../troubleshooting-rate-limits.md#telemetrytracer-was-replaced-by-telemetryinstance).

An invalid value throws a `GraxiaConfigError` from `createGraxia`, before any plugin's `setup`; see
[Troubleshooting](../troubleshooting.md).
