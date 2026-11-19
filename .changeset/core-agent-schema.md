---
"@graxia/core": minor
---

Add `@graxia/core/agent`: the descriptive directives `@needs`, `@constraint` and `@errors`, `printSchemaFor(schema, { can })` for the schema one caller may see, `lintDescriptions`, and readers (`needsOf`, `constraintOf`, `errorsOf`). Every error graxia emits now carries `extensions.fix`, including parse and validation failures, variable errors and HTTP refusals; messages and codes are unchanged.
