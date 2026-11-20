---
'@graxia/core': minor
---

Every HTTP-level refusal now carries a stable `extensions.code`: `BODY_TOO_LARGE` (413), `UNSUPPORTED_MEDIA_TYPE` (415), `BODY_UNREADABLE`, `INVALID_JSON`, `INVALID_PARAMS`, `INVALID_BATCH`, `BATCH_NOT_STREAMABLE`, `SUBPROTOCOL_REQUIRED` and `UPGRADE_FAILED` (400), `PATH_NOT_FOUND` (404), `METHOD_NOT_ALLOWED` (405, a mutation over GET included) and `NOT_ACCEPTABLE` (406). They are keys of `GraxiaErrorCodes`; the messages are unchanged.
