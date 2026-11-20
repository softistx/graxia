---
'@graxia/mcp': patch
---

A document nested so deeply that graphql's parser overflows its stack is still refused with `GRAPHQL_PARSE_FAILED`, and its fix is now core's `Flatten the operation.` instead of asking to correct the syntax.
