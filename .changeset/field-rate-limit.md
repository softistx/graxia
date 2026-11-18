---
'@graxia/core': minor
---

fieldRateLimit: per-field rate limits counted across aliases and fragments, single-selection fields, 429 with Retry-After. Adds `memoryFieldLimit`, `limitFromStore`, `DEFAULT_LIMIT_CODE` and the `RATE_LIMITED` and `FIELD_SELECTED_ONCE` error codes. Opt-in: nothing changes without the plugin.
