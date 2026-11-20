---
'@graxia/core': minor
---

Plugin support for the Envelop adapter: `setup` receives the instance's `schema`, `onExecute` and `onSubscribe` payloads expose `executeFn` (the last one set, else the engine's), and a `GraphQLError` with its own `extensions.code` thrown by a parse function keeps it instead of becoming `GRAPHQL_PARSE_FAILED`.
