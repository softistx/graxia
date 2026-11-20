---
'@graxia/core': minor
---

Add `telemetry.operationSpans: false`: when a host span is active, it drops graxia's `graphql.request` and operation spans and keeps the parse, validate and resolver spans (and the causes of masked errors) under it, a socket's operations included. With no host span graxia makes its spans as before. `telemetry: false` still turns every span off.
