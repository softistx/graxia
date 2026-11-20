---
'@graxia/core': patch
---

Adopt `@softistx/telemetry` 0.5.0 `activeSpan()` (peer `^0.5.0`): with `telemetry.operationSpans: false` under a host span, the operation attributes (`graphql.operation.type`, `graphql.operation.name`, `graxia.document.id`, `graphql.document`, `graphql.error.count`) now go on the host's span instead of the validate span. The host's span is never renamed, failed or ended.
