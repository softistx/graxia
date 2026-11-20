# Troubleshooting: security

CSRF, introspection, persisted and trusted document errors, headed by the message as it appears. The rest is in [Troubleshooting](./troubleshooting.md).

## This request requires one of the headers x-graphql-csrf, graphql-require-preflight, apollo-require-preflight, x-apollo-operation-name (CSRF prevention).

The server answered 403 `CSRF_HEADER_REQUIRED`. The request is one a browser can send cross-site
without a CORS preflight (a `GET`, or a `POST` with no `Content-Type` or a `text/plain`,
`application/x-www-form-urlencoded` or `multipart/form-data` one) and carries none of the listed
headers. Send a JSON `POST`, or add a header with any non-empty value; a client library has a
setting for it (see [Security](./guide/security.md)).

```ts
await fetch(url, {
	method: 'POST',
	headers: { 'content-type': 'application/json', 'x-graphql-csrf': '1' },
	body: JSON.stringify({ query: '{ hello }' }),
});
```

A plugin's `csrfExempt` that matches a `GET` no plugin answers gets this same 403 on purpose (an
exempt request never executes an operation): make the plugin's `onRequest` answer it with `respond`,
or narrow the predicate. See [Security](./guide/security.md).

A server no browser can reach may turn the check off with `csrf: { requireHeader: false }`. With a
custom `requireHeader` list the message names your headers instead.

## Cross-origin request refused from <origin>.

403 `FORBIDDEN_ORIGIN`. Either `csrf.sameOrigin` is on and the request's `Origin` is not the
server's own origin or in `allowedOrigins`, or a WebSocket upgrade came from such an origin (this
check is on even with `sameOrigin` off). The origin is compared with the request URL graxia sees,
so behind a proxy pass the public URL, or list the public origin. The message ends with
`from a null origin.` for `Origin: null` (a sandboxed frame, a `file:` page; always refused) and
`from an unknown origin.` for a browser request marked `Sec-Fetch-Site: cross-site` or `same-site` with no `Origin`.

```ts
createGraxia({
	schema,
	csrf: { sameOrigin: { allowedOrigins: ['https://app.example.com'] } },
});
```

## GraphQL introspection is not allowed, but the query contained __schema or __type.

`GRAPHQL_VALIDATION_FAILED` with a `fix`: `introspection` is `false`, or `NODE_ENV` is `production`
and you did not set it. Set `introspection: true` to allow it (a code generator or an explorer
needs it); `__typename` is always allowed.

## csrf must be false or an object ({ requireHeader, sameOrigin })

`createGraxia` throws a `GraxiaConfigError`. Pass `csrf: false` or an object, not `true`.

## csrf.requireHeader must be a boolean or a non-empty list of header names

`requireHeader` is `true`, `false` or a non-empty array of valid header names (no spaces).

## csrf.sameOrigin must be a boolean or an object ({ allowedOrigins, crossOrigin, onRefused })

Pass `sameOrigin: true`, `false` or `{ allowedOrigins, crossOrigin, onRefused }`.

## csrf.sameOrigin.crossOrigin must be "refuse", "json" or "allow"

Pick one of the three modes (see [Security](./guide/security.md)).

## csrf.sameOrigin.onRefused must be a function ((request, { reason, websocket }) => Response | undefined)

`onRefused` is a function returning a `Response` (or `undefined`, or a promise of either), for example
`onRefused: () => new Response('Not found', { status: 404 })`. See [Security](./guide/security.md).

## csrf.sameOrigin.allowedOrigins must be a list of origins (e.g. "https://app.example.com")

`allowedOrigins` is an array of strings.

## csrf.sameOrigin.allowedOrigins entry "x" is not an origin (use scheme, host and optional port, no path: "https://app.example.com")

An entry must be exactly `scheme://host[:port]`: no path, no trailing slash, not `null`.

## introspection must be a boolean

## suggestions must be a boolean

Both options take `true` or `false`; leave them out to follow `NODE_ENV`.

## Only persisted documents are allowed.

`trustedDocuments` is in `strict` mode (the default when `NODE_ENV=production`) and the request sent
a query in full with no id that resolves. The response is 400 with code `PERSISTED_QUERY_ONLY` and
a `fix`. Send the `documentId` (or APQ hash) from your manifest, or run `mode: 'mixed'` where
arbitrary queries are fine.

## Persisted document <id> not found.

A `documentId` (or an `extractKey` id) is in neither the manifest nor the `store`. Regenerate the
manifest and redeploy the server before the clients that use it. 400, code
`PERSISTED_QUERY_NOT_FOUND`.

## PersistedQueryNotFound

An APQ client sent a hash alone that the server never saw. It is the first step of the protocol:
the client sends the query and the hash again and the server registers it. If it loops, the `store`
loses entries (a short TTL, an eviction) or differs between processes: use `redisCache()`. Code
`PERSISTED_QUERY_NOT_FOUND`.

## PersistedQueryNotSupported

A client sent `extensions.persistedQuery` and the server cannot serve or register it: `apq` is
`false`, or the mode is `strict` and the hash is not in the manifest. Apollo Client then drops the
extension and sends the query, which `strict` refuses with `Only persisted documents are allowed.`
Code `PERSISTED_QUERY_NOT_SUPPORTED`.

## provided sha does not match query

The `sha256Hash` is not the lower-case hex SHA-256 of the `query` sent with it (UTF-8, as sent).
The client hashes a different text from the one it sends (a transform after hashing). Code
`PROVIDED_SHA_DOESNT_MATCH`.

## Unsupported persisted query version

`extensions.persistedQuery.version` is not `1`. Code `PERSISTED_QUERY_VERSION_NOT_SUPPORTED`.

## Send either documentId or query, not both.

A request has a `documentId` (or an id from `extractKey`) and a `query`. Send one. 400.

## The "persistedQuery" extension must be { version: 1, sha256Hash: string }.

`extensions.persistedQuery` is not an object with a string `sha256Hash`. 400.

## The "documentId" parameter must be a string.

The `documentId` of a body or a WebSocket payload is not a string. 400.

## trustedDocuments must be an object ({ manifest, store, apq, mode, extractKey })

The option is not an object. Leave it out to turn trusted documents off.

## trustedDocuments.mode must be "strict" or "mixed"

`mode` is something else (a typo, a boolean). Use `'strict'` or `'mixed'`, or leave it out to follow `NODE_ENV`.

## trustedDocuments.apq must be a boolean

`apq` is not `true` or `false`. Pass a boolean, or leave it out (on in `mixed`, off in `strict`).

## trustedDocuments.store must be a KeyValueCache (get, set and delete)

`store` lacks `get`, `set` or `delete`. Pass `createMemoryCache()` or `redisCache()`, or any object with the three methods.

## trustedDocuments.extractKey must be a function (params, request) => string | undefined

`extractKey` is not a function. Pass `(params, request) => string | undefined`, returning `undefined` when the request names no document.

## trustedDocuments.mode "strict" needs a manifest, or extractKey with a store: no document could ever run

`strict` runs only persisted documents, and none can exist. In production the mode is `strict` by
default, so `trustedDocuments: {}` fails there. Add a `manifest`, or `extractKey` with a `store`, or
set `mode: 'mixed'`.

## trustedDocuments.manifest must be a Map, an object of id to source, or an Apollo persisted query manifest

The manifest is none of the three formats. Pass the parsed JSON of `persisted-queries.json`,
`persisted-documents.json` or the Apollo manifest, not its text.

## trustedDocuments.manifest: the entry "<id>" must map to a GraphQL source string

An entry's source is not a non-blank string. Regenerate the manifest.

## trustedDocuments.manifest: every id must be a non-empty string

An Apollo operation without an `id`, or a `Map` key that is not a string.

## trustedDocuments.manifest: the Apollo manifest "version" must be 1

Only version 1 of `apollo-persisted-query-manifest` is read.

## trustedDocuments.manifest: the Apollo manifest "operations" must be a list of { id, body }

The Apollo manifest has no `operations` list, or an entry is not an object.
