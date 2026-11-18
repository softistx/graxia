# OpenTelemetry

graxia emits OpenTelemetry spans for each request, parse, validation and operation, and optionally
for each resolver. It needs only `@opentelemetry/api`, an optional peer: installed, tracing is on
and costs what your SDK costs; absent, graxia does nothing and wraps nothing.

## Setup

Install the API and an SDK, register the SDK once at startup (before `createGraxia`), and run.

```sh
bun add @opentelemetry/api @opentelemetry/sdk-trace-base @opentelemetry/exporter-trace-otlp-http
```

```ts
import { context } from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import {
	BasicTracerProvider,
	BatchSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { createGraxia } from '@graxia/core';

const provider = new BasicTracerProvider({
	spanProcessors: [
		new BatchSpanProcessor(
			new OTLPTraceExporter({ url: 'http://localhost:4318/v1/traces' }),
		),
	],
});

// Not required for the spans to be recorded and parented, but required for a span you start
// yourself inside a resolver to nest (it needs a context manager, see "Active span" below).
const graxia = createGraxia({
	schema,
	telemetry: { tracer: provider.getTracer('my-app') },
});
```

With the default `telemetry` (no option), graxia uses `trace.getTracer('@graxia/core')`:
register your provider globally (`trace.setGlobalTracerProvider`, or the Node SDK's `NodeSDK`) and it
is picked up. Without an SDK registered, the API's no-op tracer applies and tracing is nearly free.

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

## Attributes

| span                | attribute                                                                                                      |
| ------------------- | -------------------------------------------------------------------------------------------------------------- |
| `graphql.request`   | `http.request.method`, `graxia.request.id` (the `x-request-id`), `http.response.status_code`                   |
|                     | `graxia.refusal.code`: the code of a 4xx answer (`CSRF_HEADER_REQUIRED`, `RATE_LIMITED`, ...)                  |
|                     | `graxia.request.upgrade`: `1` on a WebSocket handshake                                                         |
| `graphql.operation` | `graphql.operation.type`, `graphql.operation.name` (when named), `graphql.error.count` (when there are some)   |
|                     | `graphql.document` (only with `document: true`), `graxia.document.id` (a persisted document or APQ hash)       |
|                     | `graxia.events` (subscriptions and incremental results: the payloads sent)                                     |
| `graphql.parse`     | `graxia.cache.hit` (the parse cache served it), `graphql.error.count`                                          |
| `graphql.validate`  | `graxia.cache.hit` (the validation cache served it), `graphql.error.count`                                     |
| `graphql.resolve x` | `graphql.field.name`, `graphql.field.path` (`user.posts.0.title`), `graphql.field.type`, `graphql.parent.type` |

Status: a span is `ERROR` only for a failure of the server. The request span is `ERROR` on a 5xx.
The operation span is `ERROR`, with the original exception recorded, when a resolver threw an
unexpected error (the ones `onUnexpected` reports and the client sees masked), when a plugin hook
or the executor threw, or when a stream failed. A validation error, a 4xx refusal (CSRF, rate limit,
a persisted document that is not found) and an exposed `GraphQLError` are the client's: no `ERROR`,
only `graphql.error.count` and `graxia.refusal.code`.

Spans are server-side: the **original** exception, with its real message and stack, is recorded
even though the client got a masked error. Treat your trace backend like your logs.

## Request kind and propagation

With no active span, `graphql.request` is a `SERVER` span and its parent is read from the request's
`traceparent` header through the registered propagator (`propagate: false` skips it). When your host
already has an active span (graxia mounted in your own handler under an instrumented server), the
request span is its `INTERNAL` child and the header is not read again.

## Subscriptions, SSE and incremental delivery

- **SSE and `multipart/mixed`**: the request span stays open until the stream ends or the client
  cancels it, so its duration is the stream's.
- A subscription or `@defer`/`@stream` operation is one operation span from start to end of the
  stream. Each payload is a span event named `graphql.event`, never a span per event; `graxia.events`
  holds the count when it ends.
- **WebSocket**: the upgrade has a short `graphql.request` span (`GET`, `graxia.request.upgrade`,
  status 101 when it succeeded). There is no request span per message: each `subscribe` is its own
  operation span, parented to the context extracted from the upgrade request's headers.

## Resolver spans

```ts
createGraxia({
	schema,
	telemetry: { resolverSpans: true }, // or { trivial: true } to include fields with no resolver
});
```

Off by default: one span per resolver call is expensive on a large list. `true` traces the resolvers
you wrote. `{ trivial: true }` also traces the fields that read a property of their parent (graphql's
default resolver), which is usually noise. Each span is a child of the operation span (not of the
resolver that returned its parent), so the tree stays flat and cheap.

The resolvers are wrapped **once, in place, on the schema you give** (graphql 17 has no hook to trace
a field's own `resolve` from outside), when `createGraxia` runs with `resolverSpans`. Sharing the
schema with another graxia instance, or with `telemetry: false`, is safe: a wrapped resolver
traces only the operations of an instance that asked for it, and otherwise calls your resolver.

## Active span

Execution runs inside the operation span's context, so `trace.getActiveSpan()` in a resolver is the
operation span (or its resolver span with `resolverSpans`), and a span you start there nests under
it. That needs a context manager registered, as any OpenTelemetry code does (the Node SDK and
`AsyncLocalStorageContextManager` from `@opentelemetry/context-async-hooks` provide one). Parenting
of graxia's own spans does not depend on it.

## The document and PII

`graphql.document` is off by default: a document can hold literals (an email, a token) that
variables would not. Turn on `document: true` only when your queries carry none, or use persisted
operations (`graxia.document.id` always identifies them).

## Without the peer

When `@opentelemetry/api` cannot be loaded, or `telemetry: false`, graxia creates no span object,
wraps no resolver and adds no work to a request. Passing `telemetry: { tracer }` without the API
installed does the same: the tracer needs the API's context to parent spans.

## Options

```ts
telemetry?: false | {
	tracer?: Tracer;                                  // default: trace.getTracer('@graxia/core')
	resolverSpans?: boolean | { trivial?: boolean };  // default false
	document?: boolean;                               // default false
	propagate?: boolean;                              // default true
};
```

An invalid value throws a `GraxiaConfigError` from `createGraxia`; see
[Troubleshooting](../troubleshooting.md).
