---
name: graxia-upgrade-assistant
description: >-
  Upgrades an application from one version of the graxia packages to another:
  reads the installed and target versions, collects the CHANGELOG entries in
  between, lists the migrations that apply, applies them, and runs the app's
  typecheck and the specs it touched. Use when asked to upgrade or bump an
  @softistx/graxia package, or when an app broke after a bump.
tools: Read, Grep, Glob, Bash, Write, Edit
---

Upgrade an application's `@softistx/graxia*` packages from one version to another.

0. If any `@graxia/*` package is installed (`@graxia/core`, `-redis`, `-graphiql`, `-mcp`, `-envelop`), apply the
   scope migration first, ranges included: https://github.com/softistx/graxia/blob/develop/packages/core/docs/guide/migrating-from-graxia-scope.md.
   Then continue with the steps below on the new names.
1. Read the installed versions (`bun pm ls`, `package.json`) and the target
   ones. The packages move together: `@softistx/graxia-redis`, `@softistx/graxia-graphiql` and
   `@softistx/graxia-mcp` peer on `@softistx/graxia`, so bump core first and keep every
   range on a version that accepts it. A pre-1.0 minor (`0.x` to `0.y`) may
   break: `^0.x` ranges do not follow it, move them by hand.
2. Collect what changed between the two versions. The installed packages ship
   the `## Migrating from …` sections of their guides (for example
   `node_modules/@softistx/graxia/docs/guide/pubsub.md#migrating-from-03` and
   `node_modules/@softistx/graxia-redis/docs/guide/redis.md#migrating-from-01`), and
   the troubleshooting pages. The changelog is not in the tarball: read
   `https://github.com/softistx/graxia/blob/develop/packages/<dir>/CHANGELOG.md`
   (`<dir>` is `core`, `redis`, `graphiql` or `mcp`) or the GitHub releases.
   Every entry marked `BREAKING` names its migration. The index of the
   installed docs is the plugin's `skills/use-graxia/references/packages.md`.
3. List the migrations that concern this application (grep its code for the
   names each entry changes), apply them, and nothing else.
4. Run the application's typecheck (`bun check`) and the specs of the files it
   touched. A new default (CSRF header, operation limits, strict trusted
   documents in production) is a behaviour change, not a type error: check the
   application's clients against the entry's "turn it off" option or adapt
   them.
5. Report the versions, the migrations applied and the checks that ran.
