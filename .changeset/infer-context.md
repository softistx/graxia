---
'@graxia/core': minor
---

Write the resolver context once: `InferContext<typeof context, typeof plugins>` derives its type from the `context` factory, the plugins and `signal`, and `createGraxia` checks at compile time that it satisfies the schema's `createSchema<Ctx>()` context (a missing or wrong key is a type error on `context`). A plain `GraphQLSchema` is not checked. `createGraxia` gains inferred type parameters (`Schema`, `Plugins`, `Made`) after `HostCtx`; new types `InferContext`, `CoreContext`, `ContextFactory`, `NeededContext`, `RequireContext`, `SchemaContext`.
