---
'@graxia/core': patch
---

Docs: a host that counts the request body itself (a stream that errors past its limit) gets 400 "The request body could not be read."; the migration guide, the HTTP guide and troubleshooting now say to drop the host limiter and set `limits.bodyBytes`, which answers 413 for an oversized `Content-Length` and for a chunked body, both covered by specs.
