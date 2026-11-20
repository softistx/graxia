# Troubleshooting: rate limits and telemetry

Field rate limit and telemetry errors, headed by the message as it appears. The rest is in [Troubleshooting](./troubleshooting.md).

## Too many requests, try again later.

A client spent a `fieldRateLimit` limit. HTTP `429`, code `RATE_LIMITED` (or your `code`),
`extensions.retryAfter` and a `Retry-After` header in seconds. Wait that long. If real users hit
it, raise the limit's `limit`, or check that `key` is not the proxy's address for everyone (see
[Rate limiting fields](./guide/rate-limiting.md)). Nothing counts when the key is `undefined`.

## <field> may be selected once per operation.

A field configured with `single: true` appears at two different places of one operation, for
example `{ a: signIn b: signIn }`. HTTP `400`, code `FIELD_SELECTED_ONCE`. Send one operation per
call, or drop `single`.

## fieldRateLimit: fields must be an object with at least one field name

`fields` is missing, empty or not an object. Pass `{ signIn: limit }`.

## fieldRateLimit: fields.<name> must be a limit ({ consume }) or { limit, single? }

The rule of `<name>` has no `consume` function, or `single` is not a boolean. Use
`memoryFieldLimit(...)`, `limitFromStore(...)`, your own `{ consume }`, or `{ limit, single: true }`.

## fieldRateLimit: ipv6Prefix must be an integer from 0 to 128

```ts
fieldRateLimit({ fields, ipv6Prefix: 64 });
```

## fieldRateLimit: ipv6Prefix only applies to the default key; reduce the address inside key() instead

`ipv6Prefix` reduces the address the default key reads. With your own `key`, drop `ipv6Prefix` and
reduce the address in `key`.

## fieldRateLimit: code must be a non-empty string

`code` is the `extensions.code` of a refusal: give a string, or leave it out for `RATE_LIMITED`.

## memoryFieldLimit: limit must be an integer of 1 or more

Also `windowMs` and `maxKeys`: `memoryFieldLimit: windowMs must be an integer of 1 or more`,
`memoryFieldLimit: maxKeys must be an integer of 1 or more`. Pass whole numbers (windows in milliseconds).

## limitFromStore: no policy; pass { limit, windowMs } or give the store a policy

The store has no `policy`: `limitFromStore(store, { limit: 10, windowMs: 60_000 })`.

## limitFromStore: limit <n> differs from the store policy's limit <m>

The same for `windowMs`. The store counts with its own policy; pass the same numbers or none.

## limitFromStore: limit must be an integer of 1 or more

Also `limitFromStore: windowMs must be an integer of 1 or more`: whole numbers, `windowMs` in milliseconds.

## telemetry must be false or an object

`telemetry` was `true`, a string or an array. Omit it (on when `@softistx/telemetry` is installed),
pass `false`, or pass an options object.

## telemetry.instance must be a @softistx/telemetry Telemetry

`instance` is not the object `createTelemetry(...)` returns. Pass it, or leave the option out to use
the installed one. A `tracer` option from before 0.4 throws its own error: see
[telemetry.tracer was replaced by telemetry.instance](#telemetrytracer-was-replaced-by-telemetryinstance).

## telemetry.tracer was replaced by telemetry.instance

The `telemetry` option still has `tracer`, the OpenTelemetry option of graxia before 0.4. Replace it
with `instance`, a `Telemetry` from `createTelemetry` in `@softistx/telemetry`, or leave it out to use
the installed one. See [Migrating](./guide/telemetry.md#migrating-from-opentelemetryapi).

## telemetry.document must be a boolean

Also `telemetry.propagate must be a boolean` and `telemetry.operationSpans must be a boolean`. Pass `true` or `false`, or leave the option out.

## telemetry.resolverSpans must be a boolean or { trivial?: boolean }

Use `resolverSpans: true`, or `resolverSpans: { trivial: true }` to include fields with no resolver.

## No spans appear

The server answers but your backend shows nothing. In order:

1. `@softistx/telemetry` is not installed next to `@softistx/graxia`. It is an optional peer: graxia
   traces nothing without it. `bun add @softistx/telemetry`.
2. No telemetry is installed or passed. Without one, spans are detached and nothing is emitted:
   call `createTelemetry(...).install()` (or pass `telemetry: { instance }`) with an exporter, such
   as `@softistx/telemetry-otlp`'s `otlpExporter`.
3. Two copies of `@softistx/telemetry`: you installed the telemetry on one and graxia reads the
   other, so its spans are detached. Check `bun pm ls @softistx/telemetry` shows one version.
4. `telemetry: false` is set.
5. A request outside the GraphQL path (`path`) is not traced.
6. `operationSpans: false` with a host span active: graxia's `graphql.request` and operation spans
   are absent by design (the operation's attributes go on the host's span for a single HTTP operation only, and `graphql.document` with `document: true`); see [the host already spans the operation](./guide/telemetry.md#the-host-already-spans-the-operation).

## A resolver span has no child spans of mine

A span you start inside a resolver nests under the active span. It is the resolver span (or the
operation span) when the telemetry is the one graxia emits to: with `telemetry: { instance }`, start
your span inside that same telemetry (`withTelemetry(instance, ...)` is already in scope in a
resolver). A span started from another copy of `@softistx/telemetry` is detached; see "No spans
appear".
