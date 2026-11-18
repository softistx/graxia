---
'@graxia/core': minor
---

trusted documents: manifests (Relay, graphql-codegen, Apollo), `documentId` (HTTP, SSE, WebSocket, `execute`), automatic persisted queries and a strict mode, on in production when `trustedDocuments` is configured. Not breaking: nothing changes while the option is absent. Adds `PERSISTED_QUERY_*` and `PROVIDED_SHA_DOESNT_MATCH` error codes, `GraphQLParams.documentId`, `documentId` on `graxia.execute` and the test client.
