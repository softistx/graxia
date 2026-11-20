---
"@graxia/core": minor
---

Add `@graxia/core/agent`: the descriptive directives `@needs`, `@constraint` and `@errors`, `@needs(anyOf:)`, `printSchemaFor(schema, { can })` and `visibleSchema` for the schema one caller may see (always with a valid `Query`), `lintDescriptions`, and readers (`needsOf`, `constraintOf`, `errorsOf`). Every error graxia emits now carries `extensions.fix`, including parse and validation failures, variable errors and HTTP refusals; messages and codes are unchanged. The permission predicate type `Can` (`(permission: string) => boolean`) is exported from `@graxia/core/agent`.
