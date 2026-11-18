---
'@graxia/core': minor
---

trusted documents: manifests (Relay, graphql-codegen, Apollo), `documentId` (HTTP, SSE, WebSocket, `execute`), automatic persisted queries and a strict mode, on in production when `trustedDocuments` is configured. Valid requests are unaffected when the option is absent. Adds `PERSISTED_QUERY_*` and `PROVIDED_SHA_DOESNT_MATCH` error codes, `GraphQLParams.documentId`, and `documentId` on `graxia.execute` and the test client. A `documentId` that is not a string is now a 400 (it was ignored). The `ExecuteBase` type became a union alias (`document` or `documentId`, exclusive); it is still exported under the same name.
