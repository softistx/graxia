# Migrating from the `@graxia` scope

The graxia packages moved to the `@softistx` scope. The code and the API are unchanged; only the
package names differ. The versions continue from the current ones (`@softistx/graxia` starts at 0.15.0).

| Old name           | New name                    |
| ------------------ | --------------------------- |
| `@graxia/core`     | `@softistx/graxia`          |
| `@graxia/envelop`  | `@softistx/graxia-envelop`  |
| `@graxia/graphiql` | `@softistx/graxia-graphiql` |
| `@graxia/mcp`      | `@softistx/graxia-mcp`      |
| `@graxia/redis`    | `@softistx/graxia-redis`    |

Subpaths keep their name: `@graxia/core/agent` is now `@softistx/graxia/agent`, and
`@graxia/core/testing` is `@softistx/graxia/testing`.

## Codemod

From your project root, this rewrites the imports and every `package.json` (macOS `sed`; on GNU
`sed` use `-i` without the empty string):

```sh
rg -l '@graxia/' --glob '!node_modules' --glob '!bun.lock' \
  | xargs sed -i '' -E 's#@graxia/core#@softistx/graxia#g; s#@graxia/(envelop|graphiql|mcp|redis)#@softistx/graxia-\1#g'
bun install
```

Review the diff, then reinstall so the lockfile follows. An error message that names a package
(for example a missing peer) now prints the new name.

## The old names are deprecated

`@graxia/*` receives no further releases. Once the new names are published, each old package is
deprecated on npm with the message `moved to <new name>`, so an install of the old name prints a
warning. Nothing is unpublished: existing installs keep working. The deprecation is made by the
publish workflow (`scripts/deprecate-moved.ts`), idempotently, and only after the replacement is on npm.
