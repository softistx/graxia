# Changesets

A change to a package carries a changeset (`bun run changeset`). Versions are made locally with
`bun run changeset:version`; after the Version PR merges, tag from an up-to-date `develop` with
`bunx changeset git-tag && git push --follow-tags` (tags `v*` or `<pkg>@<x.y.z>`): that runs `publish.yml`. See `AGENTS.md`.
