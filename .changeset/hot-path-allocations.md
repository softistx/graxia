---
'@graxia/core': patch
---

Fewer allocations per request on the hot path: the `Accept` header is read once, responses graxia builds are sealed in place, a passing cost check is remembered per document and stages without hooks run without promises (in the repository benchmark, a cached document goes from 23.2 KB to 16.1 KB of heap per request and serves about 12 to 26 % more requests per second).
