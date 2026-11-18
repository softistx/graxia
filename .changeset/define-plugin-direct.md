---
'@graxia/core': minor
---

`definePlugin({ ... })` now takes a plugin that requires no context directly, inferring what its `onContext` adds; `definePlugin<In>()({ ... })` stays for plugins that require a context. `definePlugin()({ ... })` keeps working.
