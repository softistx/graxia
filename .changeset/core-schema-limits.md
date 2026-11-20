---
"@graxia/core": minor
---

`Graxia` exposes `schema` (the schema it serves) and `limits` (`{ bodyBytes, tokens }`, defaults applied), so a layer in front of it, such as `@graxia/mcp`, reads them instead of taking them twice.

`Graxia` also exposes `trustedDocuments` (`{ mode: 'strict' | 'mixed' }` in force, the `NODE_ENV` default applied; `undefined` without the option), so a layer that forwards client documents to `graxia.execute` can refuse them in `strict`. A missing or invalid variable (refused by graphql before any field runs) and an unknown or missing operation name now carry `extensions.code: "BAD_USER_INPUT"` beside their `fix` (they had no code). `ApolloPersistedQueryManifest` types `format` as `string` and `version` as `number`, so a manifest imported from JSON type-checks; the values are still checked at boot.
