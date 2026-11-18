---
'@graxia/core': minor
---

OpenTelemetry spans for requests, parse, validate and operations, optional resolver spans; `@opentelemetry/api` is an optional peer. New `telemetry` option (`false`, or `{ tracer, resolverSpans, document, propagate }`) and the `TelemetryOptions` type. On by default when `@opentelemetry/api` is installed, a no-op otherwise; nothing changes for an application without the peer.
