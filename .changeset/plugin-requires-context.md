---
'@graxia/core': minor
---

`createGraxia` now checks each plugin's required context (`definePlugin<In>()`) against the host context: the `serverContext` type, what the `context` factory returns, `signal` and what the plugins before it add. A missing or mistyped field is a compile error naming the plugin and the field. Pre-1.0 breaking: previously compiling code that lacked a required field now fails to type-check (it failed at runtime). `GraxiaPlugin` takes a third type parameter, the literal `name` (defaulted to `string`). A plugin list that is not a tuple, an untyped `GraxiaPlugin<any, any>` and `createGraxia<Host>(…)` with an explicit type argument are not checked.
