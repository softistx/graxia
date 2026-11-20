---
'@graxia/core': minor
---

Adopt `@softistx/telemetry` 0.5.0 `activeSpan()`. The optional peer `@softistx/telemetry` moves from `^0.4.1` to `^0.5.0`. With `telemetry.operationSpans: false` under a host span, the operation attributes (`graphql.operation.type`, `graphql.operation.name`, `graxia.document.id`, `graphql.document` with `document: true`, and `graphql.error.count`) are now also written on the host's span, for a single non-batched HTTP operation only; they stay on the validate span as before. A batch entry, a WebSocket operation and the end of a stream write nothing to the host's span, and `graxia.events` never does. The host's span is never renamed, failed or ended. `document: true` now puts the document source on the host's span, which the host may export.
