---
'@graxia/core': minor
---

Add error handling: `exposedError(code, message, { extensions?, fix? })` with typed, augmentable `GraxiaErrorCodes`; unexpected resolver errors are masked as `Unexpected error.` with `INTERNAL_SERVER_ERROR` and a correlation id (the request id) in every environment, with `maskError` and `maskErrors` options; `onUnexpected` now receives `{ requestId, correlationId, phase }`; the generic 500 carries the correlation id.
