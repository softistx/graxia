# Security: CSRF, origins, introspection

Three defaults protect a server that browsers can reach. Each has an option; none replaces
authentication.

## CSRF prevention

A browser sends some requests cross-site without asking the server first (no CORS preflight): a
`GET`, `HEAD` or `POST` whose `Content-Type` is absent, `text/plain`,
`application/x-www-form-urlencoded` or `multipart/form-data`. With cookie authentication such a
request carries the user's cookies, so a hostile page could run a query as the user. graxia refuses
every such request unless it carries one non-empty header from `DEFAULT_CSRF_HEADERS`:

`x-graphql-csrf`, `graphql-require-preflight`, `apollo-require-preflight`, `x-apollo-operation-name`.

A custom header forces the browser to preflight, and a hostile page cannot pass a preflight. A JSON
`POST` (`application/json`, `application/graphql-response+json`) is preflighted already and needs no
header. The refusal is 403 with `Cache-Control: no-store` and code `CSRF_HEADER_REQUIRED`, in the
negotiated media type. It applies to every HTTP path (`GET`, `POST`, server-sent events, multipart),
not to WebSocket upgrades (see below) and not to `graxia.execute`. It runs before any plugin's
`onRequest`.

**Breaking change.** A plain `GET` query without one of the headers is now refused. Add the header
in your client, or set `csrf: { requireHeader: false }` for a server browsers cannot reach.

```ts
createGraxia({ schema, csrf: { requireHeader: ['x-my-app'] } }); // your own list
createGraxia({ schema, csrf: { requireHeader: false } }); // no header check
createGraxia({ schema, csrf: false }); // no CSRF or origin check at all
```

### Client setup

```ts
// fetch / graphql-request
await fetch(url, { headers: { 'x-graphql-csrf': '1' } });
new GraphQLClient(url, { headers: { 'x-graphql-csrf': '1' } });

// Apollo Client
new HttpLink({ uri: url, headers: { 'x-graphql-csrf': '1' } });

// urql
createClient({ url, fetchOptions: { headers: { 'x-graphql-csrf': '1' } } });
```

`createTestClient` adds `x-graphql-csrf` to its `GET` requests, so tests need no change.

## Same-origin check

`csrf.sameOrigin` checks the `Origin` header of every HTTP request (off by default; `true` is
`{ crossOrigin: 'refuse' }`). A request with no `Origin` and no cross-site signal is not a
browser's and passes. A request is same-origin when `Origin` equals the origin of the request URL
(behind a proxy, graxia must see the public URL, or list that origin) or is in `allowedOrigins`.
`Origin: null` is always refused. `Sec-Fetch-Site: cross-site` with no `Origin` counts as a
cross-origin request. A refusal is 403 `FORBIDDEN_ORIGIN`.

| `crossOrigin`      | A request from another origin                                               |
| ------------------ | --------------------------------------------------------------------------- |
| `refuse` (default) | refused                                                                     |
| `json`             | allowed when preflighted: not a simple request, or it carries a CSRF header |
| `allow`            | allowed (only `null` is refused)                                            |

```ts
createGraxia({
	schema,
	csrf: {
		sameOrigin: {
			allowedOrigins: ['https://app.example.com'],
			crossOrigin: 'refuse',
		},
	},
});
```

Each entry of `allowedOrigins` is an origin: scheme, host and optional port, no path.

## WebSocket origin

A browser sends the user's cookies with a WebSocket upgrade to any site, and cannot add a custom
header, so the header check does not apply. graxia checks the upgrade's `Origin` instead, even with
`sameOrigin` off (unless `csrf: false`): `null` or another site's origin is refused with 403
before the socket is upgraded; no `Origin` (a non-browser client) is allowed. `crossOrigin` does
not apply to an upgrade: `json` and `allow` count as `refuse`.

**Breaking change.** A browser page on another origin that opens a socket must be listed:

```ts
createGraxia({
	schema,
	csrf: { sameOrigin: { allowedOrigins: ['https://app.example.com'] } },
});
```

## Introspection and suggestions

- `introspection` (default `NODE_ENV !== 'production'`): `false` refuses `__schema` and `__type`
  with `GRAPHQL_VALIDATION_FAILED` and a `fix`; `__typename` stays allowed. It applies to every
  transport and to `graxia.execute`. A code generator or an explorer needs it on.
- `suggestions` (default `NODE_ENV !== 'production'`): `false` removes the "Did you mean ..."
  hints from validation errors and from variable coercion errors, so a client cannot learn the
  schema from typos. It does not cover a validation function a plugin replaces with
  `setValidationFn`, which receives no option.

`NODE_ENV` is read once, when `createGraxia` runs. Set `introspection: true` or
`suggestions: true` to keep them in production.
