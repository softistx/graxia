# @graxia/envelop

Run [Envelop](https://the-guild.dev/graphql/envelop) plugins inside graxia with one import and one call.

```ts
import { createGraxia } from '@graxia/core';
import { fromEnvelop } from '@graxia/envelop';
import { useDepthLimit } from '@envelop/depth-limit';

createGraxia({
	schema,
	plugins: [fromEnvelop([useDepthLimit({ maxDepth: 10 })])],
}).serve();
```

## Install

```sh
bun add @graxia/envelop @graxia/core @envelop/core graphql
bun add @envelop/depth-limit # the Envelop plugins you want
```

## Requirements

- [Bun](https://bun.sh) 1.4.4 or later (the `engines` field) and `graphql@^17.1`.
- `@graxia/core` and `@envelop/core` (`^5.6.1 || ^6.0.1`) as peer dependencies. `@envelop/core` is a runtime peer (the adapter imports it).
- `typescript` is an optional peer, for types. Use `"moduleResolution": "bundler"` in your `tsconfig.json`; `nodenext` is not supported.

## What it runs

`fromEnvelop(plugins, { name?, enforce? })` returns one graxia plugin. It honours `onPluginInit`, `onSchemaChange`,
`onEnveloped`, `onParse`, `onValidate`, `onContextBuilding`, `onExecute` and `onSubscribe`, with their after-hooks and
`onExecuteDone`, `onSubscribeResult`, `onNext`, `onEnd` and `onSubscribeError`, and `@defer` / `@stream` payloads. Anything
else (`instrumentation`, a graphql-yoga hook such as `onRequest`, an unknown name, `setSchema`, `replaceSchema`) is refused
with an error that names what to write instead: at boot, except `setSchema` called in `onEnveloped` (it throws on each
request) and `replaceSchema` (it fails when `graxia.ready` resolves). Falsy entries are skipped, so `cond && usePlugin()` works.

What the plugins add to the context is typed with a type argument, `fromEnvelop<{ currentUser: User }>([...])`; it is a
declaration, not a check.

## Tested plugins

`@envelop/depth-limit`, `@envelop/generic-auth`, `@envelop/response-cache` and `@envelop/persisted-operations` run in this
package's specs on graphql 17.1, over a real `Bun.serve`. Versions and notes are in the
[guide](./docs/guide/envelop.md#tested-plugins).

## Documentation

See [`docs/`](./docs): the [guide](./docs/guide/envelop.md), [troubleshooting](./docs/troubleshooting.md) and the
[roadmap](./docs/roadmap.md).
