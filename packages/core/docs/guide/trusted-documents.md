# Trusted documents and persisted queries

In production a GraphQL endpoint should run only the documents your own clients ship. A list of
those documents (a manifest) turns the endpoint into an allow-list: an attacker cannot send an
expensive or probing query, and clients send a short id instead of the text. Automatic persisted
queries (APQ) are the friendlier cousin for development and for clients with no build step.

```ts
import { createGraxia } from '@graxia/core';
import manifest from './persisted-documents.json';

const graxia = createGraxia({
	schema,
	trustedDocuments: { manifest }, // strict when NODE_ENV=production, mixed otherwise
});
```

Without `trustedDocuments` nothing changes: every valid document runs, and a `documentId` or APQ
extension is not understood (so existing servers are not affected by this feature).

## Options

| option       | default                                           | what it does                                                                                     |
| ------------ | ------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `manifest`   | none                                              | the trusted documents, by id (formats below)                                                     |
| `mode`       | `strict` when `NODE_ENV=production`, else `mixed` | `strict` runs only persisted documents; `mixed` also runs queries sent in full                   |
| `apq`        | `true` in `mixed`, always off in `strict`         | automatic persisted queries: a client registers a document by sending it with its hash           |
| `store`      | a memory cache of 1 000 entries (when `apq`)      | a `KeyValueCache<string>` read for ids and written by APQ; use `redisCache()` across processes   |
| `extractKey` | none                                              | `(params, request) => string \| undefined`: take the id from a header or a path, before the rest |

`NODE_ENV` is read once, when `createGraxia` runs. `mode: 'strict'` needs a `manifest`, or
`extractKey` with a `store`; otherwise nothing could ever run and `createGraxia` throws.

## Where the id comes from

In this order, the first one present wins:

1. `extractKey(params, request)`;
2. `documentId`: a field of the POST body or a GET query parameter (the GraphQL over HTTP
   persisted-documents proposal; Relay and graphql-codegen's client preset send it). Also in the
   payload of a WebSocket `subscribe` message, and `graxia.execute({ documentId })`;
3. `extensions.persistedQuery: { version: 1, sha256Hash }` (the Apollo APQ protocol).

An id is looked up in the manifest, then in the `store`. A hit becomes the request's `query`
before any plugin's `onParams` runs, so plugins, caches and limits see an ordinary query. Every
transport shares the one step: HTTP (GET, POST, each entry of a batch), SSE, WebSocket and
`execute`. A mutation found by id over GET is still refused with 405.

A `documentId` sent together with a `query` is refused (400: "Send either documentId or query, not
both."), so a client cannot smuggle text past the allow-list. With APQ, a `query` sent beside a hash
is checked against it.

**Hashes.** A hash (an APQ `sha256Hash`, or a `documentId` of the form `sha256:<hex>`) is looked up
in the manifest as `<hex>` and as `sha256:<hex>` (lower case), and in the store under one key
whichever spelling the client used. Any other id is looked up exactly as given.

## Manifest formats

The format is detected and validated when `createGraxia` runs (a bad manifest is a
`GraxiaConfigError`), and every format becomes a map from id to source.

**A plain object `{ [id]: source }`**: Relay's `persisted-queries.json` and graphql-codegen's
`persisted-documents.json` are this shape.

```json
{ "a3f1...": "query Hello { hello }" }
```

- Relay: set `persistConfig: { file: 'persisted-queries.json' }` in `relay.config.json`, and send
  `documentId` from the network layer (`operation.id`).
- graphql-codegen client preset: `presetConfig: { persistedDocuments: true }` writes
  `persisted-documents.json` next to the generated files.

**An Apollo persisted query manifest**, from `npx @apollo/generate-persisted-query-manifest`:
`{ format: 'apollo-persisted-query-manifest', version: 1, operations: [{ id, body, name, type }] }`.
The Apollo `id` is the SHA-256 of the operation, so `createPersistedQueryLink` finds it as a hash.

**A `Map<string, string>`** built in code, for example from a database.

## Client setup

```ts
// Apollo Client: automatic persisted queries, and a manifest in production
import { createPersistedQueryLink } from '@apollo/client/link/persisted-queries';
import { sha256 } from 'crypto-hash';
const link = createPersistedQueryLink({ sha256 }).concat(httpLink);

// urql
import { persistedExchange } from '@urql/exchange-persisted';
const exchanges = [
	persistedExchange({ preferGetMethod: 'within-url-limit' }),
	fetchExchange,
];
```

Relay's network layer sends `documentId: operation.id` and no `query` (see its persisted queries
guide). A CDN can cache a `GET /graphql?documentId=...&variables=...`; add one of the CSRF headers
(see [Security](./security.md)).

## Automatic persisted queries

The Apollo protocol, in three steps:

1. the client sends `extensions.persistedQuery` with the hash and no query; an unknown hash gets
   `PersistedQueryNotFound` (code `PERSISTED_QUERY_NOT_FOUND`);
2. it sends again with the query and the hash; graxia checks `sha256(query) === hash`
   (`provided sha does not match query` otherwise), runs the operation, and **registers** the query
   in the store only after it parsed and validated (an invalid document is never stored);
3. later requests send the hash alone and hit.

The answers keep the status of any other error before execution: 200 for `application/json`, 400
for `application/graphql-response+json`. Both carry the errors in the body, which is what the
clients read to retry.

Use `redisCache()` from `@graxia/redis` as the store so every process sees the registrations:

```ts
import { redisCache } from '@graxia/redis';
createGraxia({
	schema,
	trustedDocuments: {
		store: redisCache({ url: process.env.REDIS_URL, prefix: 'graxia:pq:' }),
	},
});
```

A store that throws (a Redis outage) never fails the request: a failing `get` is reported through
`onUnexpected` and answers as not found (the client then sends the query, which works in `mixed`);
a failing `set` is reported and the operation still runs.

## Strict and mixed

`mixed` runs queries sent in full, resolves ids, and does APQ when `apq` is on. `strict` runs only
what resolves to a trusted document, and a request that sends a query is refused with
`Only persisted documents are allowed.` (400, `PERSISTED_QUERY_ONLY`, with a `fix`). APQ registration
is off in `strict`, since registering is accepting an arbitrary document; a client that sends a hash
and a query graxia does not know gets `PersistedQueryNotSupported`. The manifest, and a `store` that
something else fills (with `extractKey`), still serve documents.

Run `mixed` in development, so GraphiQL and ad-hoc queries work, and `strict` in production. The
default follows `NODE_ENV`; set `mode` to pin it.

## Error codes

| message                                      | code                                    | status                   |
| -------------------------------------------- | --------------------------------------- | ------------------------ |
| `Persisted document <id> not found.`         | `PERSISTED_QUERY_NOT_FOUND`             | 400                      |
| `PersistedQueryNotFound`                     | `PERSISTED_QUERY_NOT_FOUND`             | 200 or 400 by media type |
| `PersistedQueryNotSupported`                 | `PERSISTED_QUERY_NOT_SUPPORTED`         | 200 or 400 by media type |
| `provided sha does not match query`          | `PROVIDED_SHA_DOESNT_MATCH`             | 200 or 400 by media type |
| `Unsupported persisted query version`        | `PERSISTED_QUERY_VERSION_NOT_SUPPORTED` | 200 or 400 by media type |
| `Only persisted documents are allowed.`      | `PERSISTED_QUERY_ONLY`                  | 400                      |
| `Send either documentId or query, not both.` | `BAD_USER_INPUT`                        | 400                      |

See [Troubleshooting](../troubleshooting.md) for each message and the configuration errors.
