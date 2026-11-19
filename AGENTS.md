# AGENTS.md

Instructions for any coding agent working in `graxia`.

The owner's global rules (worktrees, Conventional Commits, `bun check`, CI,
merges) are in `~/.claude/CLAUDE.md`; this file states only what is this
repository's own.

## What this repository is

graxia is a Bun-only GraphQL server engine on graphql 17: typed plugins,
GraphQL over HTTP, SSE, graphql-transport-ws on Bun's WebSocket, `@defer`/`@stream`,
trusted documents, telemetry on `@softistx/telemetry`, an MCP server. It is open source (MIT) and
published to npm under `@graxia/*`. The plan is `docs/plan.md`, the consumer
roadmap `docs/roadmap.md`, the slices are the GitHub issues `S0`..`S29`
(tracking issue "graxia v0 roadmap").

| package            | what it is                                                                                                 |
| ------------------ | ---------------------------------------------------------------------------------------------------------- |
| `@graxia/core`     | the engine (`createGraxia`, plugins, transports, limits, trusted documents, telemetry). Peer `graphql ^17` |
| `@graxia/redis`    | `redisPubSub()` and `redisCache()` on Bun.redis                                                            |
| `@graxia/graphiql` | GraphiQL 4 bundled, Apollo Sandbox option                                                                  |
| `@graxia/mcp`      | MCP over Streamable HTTP, OAuth resource server                                                            |
| `@graxia/envelop`  | `fromEnvelop(plugins)` adapter                                                                             |

`@graxia/core` is public since S8 (first publish 0.1.0) and `@graxia/redis` since S13 (first
publish 0.1.0, released with core 0.2.0); the other packages stay `"private": true` until their own slice, and removing it is
a deliberate commit of its own.

## Scripts

- `bun run changeset:status` compares against `origin/develop`; set `CHANGESET_BASE`
  to compare against another base, e.g. `CHANGESET_BASE=origin/feat/m1-http-core bun run changeset:status`
  from a slice branch of an integration branch.

## Invariants

- Bun only: `Bun.serve`, native WebSocket, `Bun.redis`. No Node or Deno adapter.
- graphql 17 only. Incremental delivery (`@defer`/`@stream`) tracks each 17.x release.
- Imports carry no extension; consumers use `"moduleResolution": "bundler"`.
- Siblings depend on each other by `workspace:^`, never `workspace:*`.
- No private application names anywhere in code, docs or issues (`@alxia/graphql` is public).
- Every package has a README, `docs/`, and a changeset per change.

## Divergences from nxgt-data

Skeleton copied from nxgt-data (`lay-out-a-library-monorepo`); declared differences:

- **No `bunfig.toml`**: no private registry; everything resolves from npmjs.
- **Public npm, `scripts/publish.ts`**: not nxgt-data's dual registry publisher, and not
  `changeset publish` either, which falls back to a plain `npm publish` that leaves
  `workspace:^` in the manifest. The script packs each public package with `bun pm pack`,
  asserts the packed manifest holds no `workspace:` range, runs `npm publish <tgz>`
  (provenance in CI), skips versions already on npm (and a publish that fails with E409 "previously staged version", when several tag runs of one commit race the registry). It refuses (dry run too) while unversioned changesets exist
  or a package is 0.0.0, and it never tags: after the Version PR merges, from an
  up-to-date `develop`, run `bunx changeset git-tag && git push --follow-tags`.
  `bun run publish:dry-run` packs and asserts only. `publishConfig` is
  `{ "access": "public" }`, and `scripts/artifacts/manifest.ts` `accessProblems` checks
  that instead of `npm.softistx.com` + `restricted`; `verify:artifacts` also fails on a
  `workspace:` range in any packed manifest.
- **`publish.yml` instead of `release.yml`**: runs `scripts/publish.ts` on tags `v*` and `**@*` (also `release: published` and
  `workflow_dispatch`), org secret `NPM_TOKEN`. The "Version packages" PR is made
  locally (`bun run changeset:version`); nothing opens it in CI. The token's npm user
  must be a member of the `graxia` npm org.
- **`typecheck` is `bun check`** (package and root), with `typecheck:scripts` kept on
  `tsc` for `scripts/` (its own relaxed tsconfig). Biome's script is `lint`/`fix`,
  never `check`. `build.ts` still uses `tsc` to emit declarations.
- **`ci.yml`**: one light job on `pull_request` to `develop` and `feat/**`; no
  service caches (Redis specs, when they land, skip without `REDIS_URL`).
  No `nightly.yml` or `nxgt-versions.yml` yet.
- **No `examples/` yet** (the workspace glob is kept; `examples/host-embedding` lands in S29).
- **`plugins/graxia`** is a stub with a hand-written package index; the generated
  index and `llms.txt` land in S26.
