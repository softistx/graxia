---
"@graxia/core": minor
---

`Graxia` exposes `schema` (the schema it serves) and `limits` (`{ bodyBytes, tokens }`, defaults applied), so a layer in front of it, such as `@graxia/mcp`, reads them instead of taking them twice.
