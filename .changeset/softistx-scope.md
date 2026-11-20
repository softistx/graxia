---
'@softistx/graxia': minor
'@softistx/graxia-envelop': minor
'@softistx/graxia-graphiql': minor
'@softistx/graxia-mcp': minor
'@softistx/graxia-redis': minor
---

The packages move to the `@softistx` scope. Nothing else changes: same code, same API, same versions line.

| Was                | Is                           |
| ------------------ | ---------------------------- |
| `@graxia/core`     | `@softistx/graxia`           |
| `@graxia/envelop`  | `@softistx/graxia-envelop`   |
| `@graxia/graphiql` | `@softistx/graxia-graphiql`  |
| `@graxia/mcp`      | `@softistx/graxia-mcp`       |
| `@graxia/redis`    | `@softistx/graxia-redis`     |

To migrate, replace the dependencies in `package.json` and the imports in your code (`@graxia/core/agent` becomes `@softistx/graxia/agent`). The one-liner codemod is in `packages/core/docs/guide/migrating-from-graxia-scope.md`. The old `@graxia/*` names are deprecated and receive no further releases.
