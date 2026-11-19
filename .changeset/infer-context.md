---
'@graxia/core': minor
---

BREAKING (pre-1.0): Write the resolver context once: `InferContext<typeof context, typeof plugins>` derives its type from the `context` factory, the plugins and `signal`, and `createGraxia` checks at compile time that it satisfies the schema's `createSchema<Ctx>()` context (a missing or wrong key is a type error on `context`). A plain `GraphQLSchema` is not checked. `createGraxia` gains inferred type parameters (`Schema`, `Plugins`, `Made`) after `HostCtx`; new types `InferContext`, `CoreContext` and `ContextFactory`; `ContextInit` now defaults its parameter. Code whose context did not satisfy `createSchema<Ctx>` now fails to compile: return the missing keys from the `context` factory, or add the plugin that provides them. Type the host on the factory (`ContextInit<{ … }>`), never with `createGraxia<…>`, which turns the check off.
