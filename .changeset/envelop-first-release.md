---
'@graxia/envelop': minor
---

First public release: `fromEnvelop(plugins)` runs Envelop plugins inside graxia as one plugin. It maps `onPluginInit`, `onSchemaChange`, `onEnveloped`, `onParse`, `onValidate`, `onContextBuilding`, `onExecute` and `onSubscribe` (with their done hooks, `onNext`, `onEnd` and `onSubscribeError`) onto graxia's stages, and refuses `instrumentation`, graphql-yoga hooks and unknown hooks at boot with the fix. Tested with `@envelop/depth-limit`, `generic-auth`, `response-cache` and `persisted-operations` on graphql 17.
