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
| `@graxia/redis`    | `redisPubSub()`, `redisCache()`, `redisFieldLimit()` on `@softistx/redis`                                  |
| `@graxia/graphiql` | GraphiQL 4 bundled, Apollo Sandbox option                                                                  |
| `@graxia/mcp`      | MCP over Streamable HTTP, OAuth resource server                                                            |
| `@graxia/envelop`  | `fromEnvelop(plugins)` adapter                                                                             |

`@graxia/core` is public since S8 (first publish 0.1.0) and `@graxia/redis` since S13 (first
publish 0.1.0, released with core 0.2.0), `@graxia/graphiql` is public from 0.4 (M4, first publish 0.1.0), `@graxia/mcp` is public since S23 (first publish 0.1.0, in 0.5), and `@graxia/envelop` is built in S27 and becomes public at its first publish (0.1.0, in 0.6; flip this line at the release); the other packages stay `"private": true` until their own slice, and removing it is
a deliberate change, named in its PR.

## Scripts

- `bun run changeset:status` compares against `origin/develop`; set `CHANGESET_BASE`
  to compare against another base, e.g. `CHANGESET_BASE=origin/feat/m1-http-core bun run changeset:status`
  from a slice branch of an integration branch.

## Generated files

Three files are generated and never edited by hand; a spec fails when one is stale.

| script                    | owns                                                      | command                            |
| ------------------------- | --------------------------------------------------------- | ---------------------------------- |
| `scripts/plugin-index.ts` | `plugins/graxia/skills/use-graxia/references/packages.md` | `bun run plugin:index` (`--check`) |
| `scripts/llms.ts`         | `llms.txt` and `llms-full.txt` at the repository root     | `bun run llms` (`--check`)         |

Run them after a change to a published package's `package.json` (version, description, peers,
`exports`), its public exports, its README, `docs/guide/*.md` or `docs/troubleshooting*.md`.
`bun run changeset:version` regenerates them too: commit the result on the Version PR branch, or the
stale specs fail. `llms.ts` writes two files, `llms.txt` and `llms-full.txt`. `bun test ./scripts/` (in CI)
runs `plugin-index.spec.ts`, `llms.spec.ts` and `plugin-manifests.spec.ts`. The index reads the
public names from the source of each `exports` entry; the roadmap pages are not in `llms*.txt`.

The release itself is its own step, after the Version PR merges: `bunx changeset git-tag && git push --follow-tags` from an up-to-date `develop`.

At a package's first publish, drop its "not published yet" wording from README.md and SKILL.md, then regenerate.

## Invariants

- Bun only: `Bun.serve`, native WebSocket, Bun's Redis client (through `@softistx/redis`). No Node or Deno adapter.
- graphql 17 only. Incremental delivery (`@defer`/`@stream`) tracks each 17.x release.
- Imports carry no extension; consumers use `"moduleResolution": "bundler"`.
- Siblings depend on each other by `workspace:^`, never `workspace:*`.
- No private application names anywhere in code, docs or issues (`@alxia/graphql` is public).
- Every package has a README, `docs/`, and a changeset per change.

## Deliberate duplication

- `packages/redis/src/channel.ts` copies core's `channelOf` and `splitPublishArgs` instead of importing them:
  core keeps them internal (not in its public surface), and the `topic:id` channel is a wire format that two
  processes on different versions must agree on, so Redis owns it. `channel.test.ts` pins both copies to the
  same output; change one, change the other.
- `packages/mcp/src/tools/operation.ts` copies core's parse fix texts (`PARSE_FIX`, the token-limit fix):
  core does not export them. Change core's wording, change the copy.
- `packages/mcp/src/operations/documents.ts` reads the three `TrustedManifest` formats itself instead of using
  core's `normalizeManifest`: core keeps it internal, and the reader must also report a bad entry by its id
  rather than throw on the first. A fourth manifest format in core is added there too
  (`operations-tools.test.ts` runs the three).

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
- **`examples/host-embedding`** is a private workspace member, never published: the root `test` runs it after the packages (`bun run --filter './examples/*' test`), and it needs `bun run build` first (it imports `@graxia/core`'s `dist`). `.changeset/config.json` keeps private packages out of versioning and tags.
- **`plugins/graxia`** carries a generated package index (see "Generated files").
