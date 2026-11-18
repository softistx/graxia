---
'@graxia/core': minor
---

operation limits: depth, aliases, directives, root fields and cost (`@cost` / `@listSize`), on by default. **Breaking**: operations over the new defaults (depth 12, 30 aliases, 50 directives, 20 root fields, cost 5 000) are now refused with `GRAPHQL_VALIDATION_FAILED`; raise a limit or set it to `false`. A schema that declares `@cost` or `@listSize` with another shape than graxia's (for example `@cost(weight: String!)`) now fails `createGraxia` with a `GraxiaConfigError` instead of failing each operation; rename or drop it, or set `limits: { cost: false }`. Adds `computeOperationCost`, `costDirectives` and the `DEFAULT_MAX_*` constants.
