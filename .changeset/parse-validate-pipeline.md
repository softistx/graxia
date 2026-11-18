---
"@graxia/core": minor
---

Add the parse and validation pipeline: `createDocumentPipeline` with token and nesting limits (stack overflow reported as `GRAPHQL_PARSE_FAILED`), a weighted LRU parse cache (failures cached), a per-schema validation cache, and `onParse` / `onValidate` driven through the plugin engine.
