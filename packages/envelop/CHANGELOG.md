# @graxia/envelop

## 0.1.2

### Patch Changes

- Updated dependencies [[`b2b814f`](https://github.com/softistx/graxia/commit/b2b814f62d03c658b3948c45ba9dca1b71a6bc40), [`c7c407e`](https://github.com/softistx/graxia/commit/c7c407e43784e509b49066b2faeeae9494d9cc52), [`54aaf11`](https://github.com/softistx/graxia/commit/54aaf115cf1ec6d566e37806fb18877263d7d462)]:
  - @graxia/core@0.8.0

## 0.1.1

### Patch Changes

- Updated dependencies [[`b0cd3ec`](https://github.com/softistx/graxia/commit/b0cd3ec4999a20ac5bb3c435483a08424a4bb7e4)]:
  - @graxia/core@0.7.0

## 0.1.0

### Minor Changes

- [#103](https://github.com/softistx/graxia/pull/103) [`33ef321`](https://github.com/softistx/graxia/commit/33ef3215c1efaabcb615c1484134d720a0310a11) Thanks [@SteveGT96](https://github.com/SteveGT96)! - First public release: `fromEnvelop(plugins)` runs Envelop plugins inside graxia as one plugin. It maps `onPluginInit`, `onSchemaChange`, `onEnveloped`, `onParse`, `onValidate`, `onContextBuilding`, `onExecute` and `onSubscribe` (with their done hooks, `onNext`, `onEnd` and `onSubscribeError`) onto graxia's stages, and refuses `instrumentation`, graphql-yoga hooks and unknown hooks at boot with the fix. Tested with `@envelop/depth-limit`, `generic-auth`, `response-cache` and `persisted-operations` on graphql 17.

### Patch Changes

- Updated dependencies [[`33ef321`](https://github.com/softistx/graxia/commit/33ef3215c1efaabcb615c1484134d720a0310a11), [`33ef321`](https://github.com/softistx/graxia/commit/33ef3215c1efaabcb615c1484134d720a0310a11), [`33ef321`](https://github.com/softistx/graxia/commit/33ef3215c1efaabcb615c1484134d720a0310a11)]:
  - @graxia/core@0.6.0
