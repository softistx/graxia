---
name: graxia-upgrade-assistant
description: >-
  Upgrades an application from one version of the graxia packages to another:
  reads the installed and target versions, collects the CHANGELOG entries in
  between, lists the migrations that apply, applies them, and runs the app's
  typecheck and the specs it touched. Use when asked to upgrade or bump an
  @graxia package, or when an app broke after a bump.
tools: Read, Grep, Glob, Bash, Write, Edit
---

Upgrade an application's `@graxia/*` packages from one version to another.

1. Read the installed versions (`bun pm ls`, `package.json`) and the target
   ones. The packages move together: `@graxia/redis`, `@graxia/graphiql` and
   `@graxia/mcp` peer on `@graxia/core`, so bump core first and keep every
   range on a version that accepts it. A pre-1.0 minor (`0.x` to `0.y`) may
   break: `^0.x` ranges do not follow it, move them by hand.
2. Read each package's `CHANGELOG.md` between the two versions, in
   `node_modules/@graxia/<package>/CHANGELOG.md` once the new version is
   installed (the changesets are the source). Every entry marked `BREAKING`
   names its migration; a docs section such as `#migrating-from-03` or
   `#migrating-from-01` gives the steps. The index of the installed docs is
   the plugin's `skills/use-graxia/references/packages.md`.
3. List the migrations that concern this application (grep its code for the
   names each entry changes), apply them, and nothing else.
4. Run the application's typecheck (`bun check`) and the specs of the files it
   touched. A new default (CSRF header, operation limits, strict trusted
   documents in production) is a behaviour change, not a type error: check the
   application's clients against the entry's "turn it off" option or adapt
   them.
5. Report the versions, the migrations applied and the checks that ran.
