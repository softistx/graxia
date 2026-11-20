---
'@graxia/core': patch
---

Fewer allocations per request on the hot path: the `Accept` header is read once, responses graxia builds are sealed in place, a passing cost check is remembered per document and stages without hooks run without promises (cached document: 23.2 KB to 16.1 KB of heap per request, +26 % requests per second).
