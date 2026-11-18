---
"@graxia/core": minor
---

Add one context per operation (batch entries included), a cancellation `signal` (client disconnect or shutdown) in `ContextInit`, the context and graphql's `abortSignal`, `getContext()` / `tryGetContext()` with the `asyncContext` option, `graxia.dispose()` / `Symbol.asyncDispose` that drains in-flight operations (503 `SHUTTING_DOWN` for new ones, `shutdownTimeout`) and the plugin hook `onDispose`.
