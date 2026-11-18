# OpenTelemetry

graxia emits OpenTelemetry spans for each request, parse, validation and operation, and optionally
for each resolver. It needs only `@opentelemetry/api`, an optional peer: installed, tracing is on
and costs what your SDK costs; absent, graxia does nothing and wraps nothing.

## Setup

Install the API, an SDK, an exporter and a context manager. Register them once at startup, before
`createGraxia`.

```sh
bun add @opentelemetry/api @opentelemetry/sdk-trace @opentelemetry/context-async-hooks @opentelemetry/exporter-trace-otlp-http
```

```ts
import { context, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { BatchSpanProcessor, TracerProvider } from '@opentelemetry/sdk-trace';
import { createGraxia } from '@graxia/core';

// The context manager makes `trace.getActiveSpan()` and the spans you start in a resolver nest.
context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());

trace.setGlobalTracerProvider(
	new TracerProvider({
		spanProcessors: [
			new BatchSpanProcessor({
				exporter: new OTLPTraceExporter({
					url: 'http://localhost:4318/v1/traces',
				}),
			}),
		],
	}),
);

// graxia uses `trace.getTracer('@graxia/core')`, so the provider above is picked up.
const graxia = createGraxia({ schema });
```

To keep the provider out of the global, pass its tracer instead:
`createGraxia({ schema, telemetry: { tracer: provider.getTracer('my-app') } })`. Without any SDK
registered, the API's tracer records nothing and graxia skips the rest of the work for the request
(no attribute, no child span, no copy of the response).

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
|                     | `graxia.event.index` on each `graphql.event` span event (1, 2, ...)                                            |
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

## Active span

Execution runs inside the operation span's context, so `trace.getActiveSpan()` in a resolver is the
operation span (or its resolver span with `resolverSpans`), and a span you start there nests under
it. That needs a context manager registered, as any OpenTelemetry code does: the
`AsyncLocalStorageContextManager` line of [Setup](#setup). Parenting of graxia's own spans does not
depend on it.

## The document and PII

`graphql.document` is opt-in: a document can hold literals (an email, a token) that
variables would not. Turn on `document: true` only when your queries carry none, or use persisted
operations (`graxia.document.id` always identifies them).

## Without the peer

When `@opentelemetry/api` cannot be loaded, or `telemetry: false`, graxia creates no span object,
wraps no resolver and adds no work to a request. Passing `telemetry: { tracer }` without the API
installed does the same: the tracer needs the API's context to parent spans.

## Options

```ts
telemetry?: false | {
	tracer?: Tracer;
	resolverSpans?: boolean | { trivial?: boolean };
	document?: boolean;
	propagate?: boolean;
};
```

| option          | default                                   | meaning                                                                  |
| --------------- | ----------------------------------------- | ------------------------------------------------------------------------ |
| `telemetry`     | on when `@opentelemetry/api` is installed | `false` turns every span off                                             |
| `tracer`        | `trace.getTracer('@graxia/core')`         | the tracer the spans come from                                           |
| `resolverSpans` | `false`                                   | `true`: your resolvers; `{ trivial: true }`: fields with no resolver too |
| `document`      | `false`                                   | the document source on `graphql.document` (may hold literals)            |
| `propagate`     | `true`                                    | read the `traceparent` header of a request with no active span           |

An invalid value throws a `GraxiaConfigError` from `createGraxia`, before any plugin's `setup`; see
[Troubleshooting](../troubleshooting.md).
