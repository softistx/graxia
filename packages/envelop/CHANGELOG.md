# @graxia/envelop

## 0.1.0

### Minor Changes

- [#103](https://github.com/softistx/graxia/pull/103) [`33ef321`](https://github.com/softistx/graxia/commit/33ef3215c1efaabcb615c1484134d720a0310a11) Thanks [@SteveGT96](https://github.com/SteveGT96)! - First public release: `fromEnvelop(plugins)` runs Envelop plugins inside graxia as one plugin. It maps `onPluginInit`, `onSchemaChange`, `onEnveloped`, `onParse`, `onValidate`, `onContextBuilding`, `onExecute` and `onSubscribe` (with their done hooks, `onNext`, `onEnd` and `onSubscribeError`) onto graxia's stages, and refuses `instrumentation`, graphql-yoga hooks and unknown hooks at boot with the fix. Tested with `@envelop/depth-limit`, `generic-auth`, `response-cache` and `persisted-operations` on graphql 17.

### Patch Changes

- Updated dependencies [[`33ef321`](https://github.com/softistx/graxia/commit/33ef3215c1efaabcb615c1484134d720a0310a11), [`33ef321`](https://github.com/softistx/graxia/commit/33ef3215c1efaabcb615c1484134d720a0310a11), [`33ef321`](https://github.com/softistx/graxia/commit/33ef3215c1efaabcb615c1484134d720a0310a11)]:
  - @graxia/core@0.6.0
