# @softistx/graxia-envelop

> Released as `@graxia/envelop` up to the last version below; the package moved to `@softistx/graxia-envelop` in the next minor.

## 0.2.0

### Minor Changes

- [#170](https://github.com/softistx/graxia/pull/170) [`801a435`](https://github.com/softistx/graxia/commit/801a43525d1dc5165fe6d34ba51b676918cf10e9) Thanks [@SteveGT96](https://github.com/SteveGT96)! - The packages move to the `@softistx` scope. Nothing else changes: same code, same API, same versions line.

  | Was                | Is                          |
  | ------------------ | --------------------------- |
  | `@graxia/core`     | `@softistx/graxia`          |
  | `@graxia/envelop`  | `@softistx/graxia-envelop`  |
  | `@graxia/graphiql` | `@softistx/graxia-graphiql` |
  | `@graxia/mcp`      | `@softistx/graxia-mcp`      |
  | `@graxia/redis`    | `@softistx/graxia-redis`    |

  To migrate, replace the dependencies in `package.json` and the imports in your code (`@graxia/core/agent` becomes `@softistx/graxia/agent`). The one-liner codemod is in `packages/core/docs/guide/migrating-from-graxia-scope.md`. The old `@graxia/*` names are deprecated and receive no further releases.

### Patch Changes

- Updated dependencies [[`983095f`](https://github.com/softistx/graxia/commit/983095f56f93bc1811ee4330704deb509fe8b01e), [`801a435`](https://github.com/softistx/graxia/commit/801a43525d1dc5165fe6d34ba51b676918cf10e9)]:
  - @softistx/graxia@0.15.0

## 0.1.8

### Patch Changes

- Updated dependencies [[`f5ef13f`](https://github.com/softistx/graxia/commit/f5ef13fec198d0af098c94b97904a0e2e3053840)]:
  - @graxia/core@0.14.0

## 0.1.7

### Patch Changes

- Updated dependencies [[`9f7f3fa`](https://github.com/softistx/graxia/commit/9f7f3fac773e77a6f0738b85901bfa4f6d5ce7c7)]:
  - @graxia/core@0.13.0

## 0.1.6

### Patch Changes

- Updated dependencies [[`5c7cd1c`](https://github.com/softistx/graxia/commit/5c7cd1c2b747e9af5c379d2a8a4915b6ee9295a3)]:
  - @graxia/core@0.12.0

## 0.1.5

### Patch Changes

- Updated dependencies [[`e802b0a`](https://github.com/softistx/graxia/commit/e802b0a7c2ab281228222797e36c4e70143c0ccc)]:
  - @graxia/core@0.11.0

## 0.1.4

### Patch Changes

- Updated dependencies [[`8efc081`](https://github.com/softistx/graxia/commit/8efc081372345df50387894f77f2b36a97194f6d), [`1b7629d`](https://github.com/softistx/graxia/commit/1b7629d1445ce83ca201ae375967cb899b845ed2)]:
  - @graxia/core@0.10.0

## 0.1.3

### Patch Changes

- Updated dependencies [[`730f845`](https://github.com/softistx/graxia/commit/730f845cb04e1cd64d1fecbc3821285ec6f03519)]:
  - @graxia/core@0.9.0

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
