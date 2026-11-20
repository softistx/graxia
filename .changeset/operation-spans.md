---
"@graxia/core": minor
---

Add `telemetry.operationSpans: false`: it drops graxia's `graphql.request` and operation spans and keeps the parse, validate and resolver spans (and the causes of masked errors) under the host's active span, for a host that already spans the request. `telemetry: false` still turns every span off.
