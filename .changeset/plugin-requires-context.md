---
'@graxia/core': minor
---

`createGraxia` now checks each plugin's required context (`definePlugin<In>()`) against the host context: what the `context` factory returns, the `serverContext` type declared on its `init`, `signal` and what the plugins before it add. A missing or mistyped field is a compile error naming the plugin and the field; an optional field may be absent. Pre-1.0 breaking: code that lacked a required field used to compile even when nothing provided the field, and either failed at runtime or worked only through an untyped `serverContext`; it now fails to type-check. `GraxiaPlugin` takes a third type parameter, the literal `name` (defaulted to `string`). Not checked: a plugin list that is not a tuple, an untyped `GraxiaPlugin<any, any>` (that plugin alone) and `createGraxia<Host>(…)` with an explicit type argument.
