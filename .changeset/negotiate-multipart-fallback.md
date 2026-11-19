---
'@graxia/core': patch
---

`@defer` and `@stream` now stream over `multipart/mixed` when a client names it after JSON, as GraphiQL does (`Accept: application/json, multipart/mixed`); it used to answer `INCREMENTAL_NOT_SUPPORTED`. Only an incremental operation is affected: `Accept: application/json` alone is still refused, and any other operation keeps JSON.
