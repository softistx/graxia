# Migrating from the `@graxia` scope

The graxia packages moved to the `@softistx` scope. The code and the API are unchanged; the package
names differ, and so do the versions: each new name starts at the next minor of the old one, so an old
range such as `^0.14.0` resolves to nothing under the new name.

| Old name           | New name                    | First version |
| ------------------ | --------------------------- | ------------- |
| `@graxia/core`     | `@softistx/graxia`          | 0.15.0        |
| `@graxia/envelop`  | `@softistx/graxia-envelop`  | 0.2.0         |
| `@graxia/graphiql` | `@softistx/graxia-graphiql` | 0.3.0         |
| `@graxia/mcp`      | `@softistx/graxia-mcp`      | 0.2.0         |
| `@graxia/redis`    | `@softistx/graxia-redis`    | 0.3.0         |

Subpaths keep their name: `@graxia/core/agent` is now `@softistx/graxia/agent`, and
`@graxia/core/testing` is `@softistx/graxia/testing`.

## Steps

1. Rewrite the imports and any other mention of the old names (docs, workflows, config), hidden
   folders included. `perl -pi` is portable across macOS and GNU:

   ```sh
   rg -l --hidden --glob '!.git' --glob '!node_modules' --glob '!bun.lock' '@graxia/' . \
     | xargs perl -pi -e 's#\@graxia/core#\@softistx/graxia#g; s#\@graxia/(envelop|graphiql|mcp|redis)#\@softistx/graxia-$1#g'
   ```

   This also renames the dependency keys in `package.json`, but keeps their old ranges.

   Without ripgrep, list the files with `grep -rl --exclude-dir=node_modules --exclude-dir=.git --exclude=bun.lock "@graxia/" .` and pipe them to the same `xargs perl` line.

2. Set the ranges to the new versions (the old ones match nothing). Use only the packages you have:

   ```sh
   bun add @softistx/graxia@^0.15.0 @softistx/graxia-redis@^0.3.0 \
     @softistx/graxia-graphiql@^0.3.0 @softistx/graxia-mcp@^0.2.0 @softistx/graxia-envelop@^0.2.0
   ```

   `bun add` rewrites the existing entry, in `dependencies` or `devDependencies` alike. Peers that name
   a graxia package (in a library of yours) get the same range by hand.

3. Run your typecheck and tests. An error that names a package (a missing peer, for example) now prints the new name.

Or do it without the codemod: `bun remove @graxia/core …`, then `bun add @softistx/graxia@^0.15.0 …`,
then replace the imports.

## The old names are deprecated

`@graxia/*` receives no further releases. Once the new names are published, each old package is
deprecated on npm with the message `moved to <new name>`, so an install of the old name prints a
warning. Nothing is unpublished: existing installs keep working. The deprecation is made by the
publish workflow (`scripts/deprecate-moved.ts`), idempotently, and only after the replacement is on npm.
