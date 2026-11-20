---
name: use-graxia
description: >-
  Wire and use graxia, the Bun-native GraphQL server engine, in an application:
  install @softistx/graxia and its graphql 17 peer, and respect the contracts the
  package states. This is the index: the package ships the detail. Use when an
  app depends on @softistx/graxia or adds a GraphQL server on Bun.
---

# Use graxia

`@softistx/graxia` ships GraphQL over HTTP (`createGraxia`, `fetch`, `serve`),
typed plugins, per-operation context and cancellation, error masking
(`exposedError`), in-process `execute` with a test client
(`@softistx/graxia/testing`), subscriptions over server-sent events and WebSocket
(`graphql-transport-ws`, both on by default), `@defer` and `@stream` over
`multipart/mixed` and SSE, a typed `PubSub` (`createPubSub`) and a
`KeyValueCache` (`createMemoryCache`). Since 0.3.0 it is also secure by default
and production-ready: CSRF prevention and a WebSocket `Origin` check, operation
limits (depth, aliases, directives, root fields, `@cost` / `@listSize` cost),
introspection and suggestions off under `NODE_ENV=production`, trusted
documents (manifests, `documentId`, APQ, strict mode), `fieldRateLimit`, and
spans on `@softistx/telemetry` (optional peer; `createTelemetry(...).install()`
with an exporter such as `@softistx/telemetry-otlp`). `@softistx/graxia/agent` adds descriptive `@needs` / `@constraint` / `@errors`
directives, `printSchemaFor` and `visibleSchema` (the schema one caller may see),
`lintDescriptions` and readers, multipart file uploads behind `uploads` (off by default; the `GraphQLFile` scalar gives resolvers a Web `File`; needs the CSRF header), and every graxia error carries `extensions.fix`
(`node_modules/@softistx/graxia/docs/guide/errors.md#the-fix-contract`). `@softistx/graxia-redis`
puts the PubSub, the cache and a field rate limit on Redis (`redisPubSub`, `redisCache`,
`redisFieldLimit`), on `@softistx/redis` (peer, with `@softistx/graxia`); breaking in 0.2: see
`node_modules/@softistx/graxia-redis/docs/guide/redis.md#migrating-from-01`. The peer of core is `graphql ^17.1.0`. Coming from `@alxia/graphql`: `node_modules/@softistx/graxia/docs/guide/migrating-from-alxia-graphql.md`; an app that owns `Bun.serve`: the host-embedding example it links.

The detail lives in the installed packages: `node_modules/@softistx/<package>/README.md` and
`node_modules/@softistx/<package>/docs/` (guides, troubleshooting, roadmap). `references/packages.md` is the
generated index: each package's install line, peers, entry points with their public names, and every doc page
with its title. This skill points at them and never copies them. Read `docs/guide/security.md` and
`docs/guide/production.md` of core before shipping. A bad variable or operation name answers `BAD_USER_INPUT`,
and each package's `docs/troubleshooting.md` heads every entry with the message as it appears.

Breaking defaults to know when adopting 0.3.0 (the changesets say how to turn each off; the values are in
`node_modules/@softistx/graxia/docs/guide/security.md` and `node_modules/@softistx/graxia/docs/guide/limits-and-caches.md`):

- a `GET` or a non-JSON `POST` needs a CSRF header, otherwise 403
  `CSRF_HEADER_REQUIRED` (this includes a browser `EventSource`);
- a WebSocket upgrade from another `Origin` is 403 `FORBIDDEN_ORIGIN` unless it is allowed;
- operations over the depth, alias, directive, root-field or cost limits are refused;
- under `NODE_ENV=production` introspection and "Did you mean" hints are off,
  and trusted documents (when configured) are `strict`; `graxia.trustedDocuments` gives the mode in force.

Breaking in 0.4.0 (pre-1.0; the changesets and the changelog on GitHub,
`https://github.com/softistx/graxia/blob/develop/packages/core/CHANGELOG.md`, say how to migrate):

- `createMemoryPubSub` became `createPubSub` with tuple topics
  (`node_modules/@softistx/graxia/docs/guide/pubsub.md#migrating-from-03`);
- telemetry runs on the optional peer `@softistx/telemetry` instead of `@opentelemetry/api`
  (`node_modules/@softistx/graxia/docs/guide/telemetry.md#migrating-from-opentelemetryapi`);
- `InferContext<typeof context, typeof plugins>` writes the resolver context once and `createGraxia` checks it
  against `createSchema<Ctx>()`: a context that does not satisfy it no longer compiles;
- `createSchema<Ctx, Resolvers>()` refuses a resolver map generated for another context
  (`node_modules/@softistx/graxia/docs/guide/codegen.md`);
- `createGraxia` gained inferred type parameters after `HostCtx`, and `ContextInit` defaults its parameter.

Write the resolver context once: `type Ctx = InferContext<typeof context, typeof plugins>`, then
`createSchema<Ctx>()`; `createGraxia` checks at compile time that the factory, plugins and
`signal` provide it. Type the host as `ContextInit<{ … }>` on the factory, or write it explicitly with the curried form `createGraxia<Host>()({ … })`; never `createGraxia<Host>({ … })`, which turns both the schema and the plugin checks off. Over a WebSocket the factory reads the `connection_init` payload as `init.connectionParams` (typed; undefined over HTTP and SSE). An `onParams` header check must skip WebSocket operations with the payload's `connectionParams` (set only over a socket); never test the forgeable `Upgrade` header.

With graphql-codegen, point `contextType` at the `InferContext` type and pass the generated `Resolvers` as
`createSchema<Ctx, Resolvers>()`'s second generic; a map generated for another context is a type error.

For a browser explorer in development, `@softistx/graxia-graphiql` (from 0.1.0) adds `graphiql()` or `apolloSandbox()` to
`plugins`: the page is served by the endpoint itself, off under `NODE_ENV=production`, one explorer per server;
read `node_modules/@softistx/graxia-graphiql/docs/`.

To run Envelop plugins (depth-limit, generic-auth, response-cache, ...), `@softistx/graxia-envelop` (from 0.1.0) is
`plugins: [fromEnvelop([useDepthLimit({ maxDepth: 10 })])]`; see
`node_modules/@softistx/graxia-envelop/docs/guide/envelop.md`. To let an agent use the API over MCP, `@softistx/graxia-mcp` (from 0.1.0) is
`createMcp(graxia, { name })`, mounted on `/mcp` as `'/mcp': (req, server) => mcp.fetch(req, { server })`, with an
optional OAuth resource server (`auth`) and persisted operations as typed tools (`operations`). Read
`node_modules/@softistx/graxia-mcp/docs/guide/getting-started.md`, `node_modules/@softistx/graxia-mcp/docs/guide/auth.md` and
`node_modules/@softistx/graxia-mcp/docs/guide/operations.md`.
