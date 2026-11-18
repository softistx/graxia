---
'@graxia/core': minor
---

operation limits: depth, aliases, directives, root fields and cost (`@cost` / `@listSize`), on by default. **Breaking**: operations over the new defaults (depth 12, 30 aliases, 50 directives, 20 root fields, cost 5 000) are now refused with `GRAPHQL_VALIDATION_FAILED`; raise a limit or set it to `false`. Adds `computeOperationCost`, `costDirectives` and the `DEFAULT_MAX_*` constants.
