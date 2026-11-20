---
'@graxia/core': minor
---

Add the curried form `createGraxia<Host>()(options)`. An explicit type argument on the direct call, `createGraxia<Host>(options)`, stops TypeScript inferring the schema, the plugins and the factory's result, so neither the schema's needed context nor each plugin's required context was checked. The curried form takes the host explicitly and infers the rest, so both checks run; it returns the same `Graxia<Host>`. The direct call is unchanged. The plugin-requirement error message now names the curried form among the ways to provide a field.
