# @graxia/mcp

## 0.1.4

### Patch Changes

- Updated dependencies [[`b2b814f`](https://github.com/softistx/graxia/commit/b2b814f62d03c658b3948c45ba9dca1b71a6bc40), [`c7c407e`](https://github.com/softistx/graxia/commit/c7c407e43784e509b49066b2faeeae9494d9cc52), [`54aaf11`](https://github.com/softistx/graxia/commit/54aaf115cf1ec6d566e37806fb18877263d7d462)]:
  - @graxia/core@0.8.0

## 0.1.3

### Patch Changes

- Updated dependencies [[`b0cd3ec`](https://github.com/softistx/graxia/commit/b0cd3ec4999a20ac5bb3c435483a08424a4bb7e4)]:
  - @graxia/core@0.7.0

## 0.1.2

### Patch Changes

- [#114](https://github.com/softistx/graxia/pull/114) [`57441c2`](https://github.com/softistx/graxia/commit/57441c28e5256423a8d8c2f343b42564d01128d4) Thanks [@SteveGT96](https://github.com/SteveGT96)! - The typed-tools internals no longer use `any` for the host context. The operations guide now says what a manifest that yields no tool does, that a throwing `can` leaves the typed tools out of `tools/list`, and that GraphQL Code Generator's client preset drops operation descriptions (use `descriptions`).

- [#110](https://github.com/softistx/graxia/pull/110) [`6f1603c`](https://github.com/softistx/graxia/commit/6f1603c079c5fb9d13a6c988a3187372ce064f80) Thanks [@SteveGT96](https://github.com/SteveGT96)! - A document nested so deeply that graphql's parser overflows its stack is still refused with `GRAPHQL_PARSE_FAILED`, and its fix is now core's `Flatten the operation.` instead of asking to correct the syntax.
- Updated dependencies [[`57441c2`](https://github.com/softistx/graxia/commit/57441c28e5256423a8d8c2f343b42564d01128d4), [`566a13c`](https://github.com/softistx/graxia/commit/566a13c3ef9d8d018bab10a3868401b9d7512ca1), [`7503614`](https://github.com/softistx/graxia/commit/750361498e9c78ebf67b33c718e1754b47326d67)]:
  - @graxia/core@0.6.2

## 0.1.1

### Patch Changes

- Updated dependencies [[`33ef321`](https://github.com/softistx/graxia/commit/33ef3215c1efaabcb615c1484134d720a0310a11), [`33ef321`](https://github.com/softistx/graxia/commit/33ef3215c1efaabcb615c1484134d720a0310a11), [`33ef321`](https://github.com/softistx/graxia/commit/33ef3215c1efaabcb615c1484134d720a0310a11)]:
  - @graxia/core@0.6.0

## 0.1.0

### Minor Changes

- [#95](https://github.com/softistx/graxia/pull/95) [`6ec2589`](https://github.com/softistx/graxia/commit/6ec2589e1de9241b8d6fc52de73a66ef629bd0e1) Thanks [@SteveGT96](https://github.com/SteveGT96)! - First public release of `@graxia/mcp`: `createMcp(graxia, { name })`, a stateless Streamable HTTP MCP server on the Web `Request`/`Response` pair (the schema and the body limit come from `graxia.schema` and `graxia.limits`), with the tools `graphql_schema` (overview, `types`, `search`), `graphql_query` and, with `mutations: true`, `graphql_mutate`. Operations are validated against the schema the caller may see (`can`; introspection is refused) and run through `graxia.execute`, whose codes and fixes reach the agent. DNS-rebinding guard (`Origin` and `Host`, `allowedHosts`), CORS for `allowedOrigins`, a body size cap, `onError`, and a `fix` on every refusal.

  OAuth resource server: `auth: { resource, authorizationServers, verifyToken }` makes every request need a bearer token with `mcp:read` (401 and 403 `WWW-Authenticate` challenges with `resource_metadata`, an `access_token` in the query refused, expiry and audience checked: a token whose info has no `audience` is refused unless `auth.audience: 'verifier'`; a verifier that throws is a 503 with `Retry-After`, and it may resolve its own `Response`; Bearer only, no DPoP), `graphql_mutate` listed and callable only with `mcp:write` (a read-only call is a 403 step-up when `mutations` is on), the RFC 9728 metadata at `mcp.metadataPath` (`mcp.metadata`; typed `string` when `auth` is passed), the verified token as `can`'s third argument and `mcpAuth()` for graxia's `context` builder. New codes `MCP_UNAUTHORIZED`, `MCP_INSUFFICIENT_SCOPE` and `MCP_TOKEN_IN_URL`.

  Persisted operations as typed tools: `operations: { documents, include?, descriptions? }` takes core's `TrustedManifest` (codegen or Relay object, Apollo manifest, `Map`) and makes each named query, and each mutation with `mutations: true`, one tool (`BookById` is `book_by_id`) with a JSON Schema 2020-12 input built from its variables (scalars, enums, lists, input objects through `$defs`, `@oneOf`, defaults, `@constraint`) and an output schema built from its selection set. A description is required (the operation's own, or `descriptions`); `createMcp` throws one `GraxiaConfigError` listing every problem with its fix. A tool is listed only when its operation is valid in the caller's view, and a mutation tool needs the write scope (the 403 step-up names the tool called). An argument the input schema does not have is refused with the new code `MCP_UNKNOWN_ARGUMENT`; a variable graxia refuses keeps its `BAD_USER_INPUT` code with the fix `Correct the arguments: see the tool's input schema.` `genericTools: false` keeps only `graphql_schema` and the typed tools. With trusted documents in `strict` mode (`graxia.trustedDocuments.mode`), `graphql_query` and `graphql_mutate` are not listed and a call answers `PERSISTED_QUERY_ONLY` without running the document: only the typed tools run operations. The caller's view is built (and `can` called) only for `tools/list` and `tools/call`. New types `McpOperationsOptions` and `McpOperationInfo`.

  `mcp.dispose()` stops the handler (named like `graxia.dispose()`). Types exported: `Mcp`, `McpOptions`, `McpHost` (a host must carry `trustedDocuments`, so a hand-made one cannot switch strict mode off by omission), `Can` (re-exported from `@graxia/core/agent`), `McpAuthOptions`, `McpAuthInfo`, `McpScopes`, `McpOperationsOptions`, `McpOperationInfo` and `McpErrorCode`, the union of the codes the package emits: `MCP_OPERATION_NOT_ALLOWED`, `MCP_EXECUTION_REFUSED`, `MCP_UNKNOWN_ARGUMENT`, `MCP_UNAUTHORIZED`, `MCP_INSUFFICIENT_SCOPE` and `MCP_TOKEN_IN_URL`. Boot problems are `GraxiaConfigError`s: `auth`, `operations`, an `allowedHosts` or `allowedOrigins` entry that can never match, and, through `onError`, strict trusted documents with no typed tool.

### Patch Changes

- Updated dependencies [[`6ec2589`](https://github.com/softistx/graxia/commit/6ec2589e1de9241b8d6fc52de73a66ef629bd0e1), [`6ec2589`](https://github.com/softistx/graxia/commit/6ec2589e1de9241b8d6fc52de73a66ef629bd0e1)]:
  - @graxia/core@0.5.0
