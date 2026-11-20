---
'@graxia/core': patch
---

The `@cost` and `@listSize` directives and each of their arguments now carry a description, in the `GraphQLDirective` objects and in the SDL `createSchema` adds, so a schema that must describe every element no longer needs an allowlist for them.
