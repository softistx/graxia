---
'@graxia/core': minor
---

The payloads of `onRequest`, `onParse` and `onValidate` carry a read-only `serverContext`, over HTTP and over WebSocket (the context the upgrade was given). A host plugin can now tie a document that fails validation to its socket without a `WeakMap` keyed by the upgrade request.
