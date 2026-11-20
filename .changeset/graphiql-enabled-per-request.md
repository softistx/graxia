---
'@graxia/graphiql': minor
---

`enabled` of `graphiql()` and `apolloSandbox()` also takes a function `(request: Request) => boolean`, called for each GET the explorer would answer; `false` falls through as a disabled explorer does. A value that is neither a boolean nor a function throws a `GraxiaConfigError`. The docs now say that an unset `NODE_ENV` serves the page and show `enabled: () => myDevFlag`.
