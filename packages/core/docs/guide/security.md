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

### Uploads

A `multipart/form-data` POST is a simple request, so [uploads](./uploads.md) always need the CSRF header, checked before the body is read. `createGraxia` refuses `uploads` with `csrf: false` or `csrf: { requireHeader: false }` at boot.

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

`createTestClient` adds the instance's CSRF header (the first of its list) to its `GET` requests, so tests need no change.

## Exempting a plugin's own GET requests

A plugin may declare `csrfExempt(request: Request): boolean` for the few `GET` requests it serves
itself and a browser cannot send with a custom header: a page opened by navigation, or the
`<script>` and `<link>` it loads (the GraphiQL page of `@graxia/graphiql` is the case).

- Core consults it for `GET` only, and only for the CSRF **header** check. The `Origin` check
  (`csrf.sameOrigin`), the path check and the method check still apply.
- **Invariant**: an exempt request must be answered by a plugin's `onRequest` through `respond`.
  If no plugin responds, core refuses it with the 403 `CSRF_HEADER_REQUIRED` it would have given, so
  an exempt `GET` can never execute an operation, even if the predicate matches `?query={__typename}`.
- A predicate that throws counts as `false` and is reported to `onUnexpected` (`phase: "request"`).
- Match as narrowly as you can (a path plus a marker parameter, never `() => true`), and let only
  plugins you trust declare it: it removes the CSRF protection of what it matches.

```ts
definePlugin({
	name: 'status-page',
	csrfExempt: (request) => new URL(request.url).searchParams.has('status-page'),
	onRequest: ({ request, respond }) => {
		if (new URL(request.url).searchParams.has('status-page'))
			respond(new Response('ok'));
	},
});
```

## Same-origin check

`csrf.sameOrigin` checks the `Origin` header of every HTTP request (off by default; `true` is
`{ crossOrigin: 'refuse' }`). A request with no `Origin` and no cross-site signal is not a
browser's and passes. A request is same-origin when `Origin` equals the origin of the request URL
(behind a proxy, graxia must see the public URL, or list that origin) or is in `allowedOrigins`.
`Origin: null` is always refused. `Sec-Fetch-Site: cross-site` or `same-site` with no `Origin` counts as a
cross-origin request (it fails closed); `same-origin` and `none` pass. A refusal is 403 `FORBIDDEN_ORIGIN`, unless `refuse` answers it.

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

### Answering a refused origin yourself

`refuse(request, reason)` replaces the 403 `FORBIDDEN_ORIGIN` with your own `Response` (it may be
async). It runs for every refusal, a WebSocket upgrade's included, and never for an allowed
request. `reason` is `'cross-origin'` (another origin), `'null-origin'` (`Origin: null`) or
`'cross-site'` (no `Origin`, but `Sec-Fetch-Site` says another site). Without it the default
403 is unchanged. A non-function throws `csrf.sameOrigin.refuse must be a function`.

```ts
createGraxia({
	schema,
	csrf: {
		sameOrigin: {
			allowedOrigins: ['https://app.example.com'],
			// hide the endpoint from other sites
			refuse: (request, reason) =>
				reason === 'cross-origin'
					? new Response('Not found', { status: 404 })
					: new Response(null, { status: 403 }),
		},
	},
});
```

## WebSocket origin

A browser sends the user's cookies with a WebSocket upgrade to any site, and cannot add a custom
header, so the header check does not apply. graxia checks the upgrade's `Origin` instead, even with
`sameOrigin` off (unless `csrf: false`): `null` or another site's origin is refused with 403
before the socket is upgraded. A missing `Origin` (a non-browser client) is allowed, except when `Sec-Fetch-Site` marks the request as cross-site or same-site. `crossOrigin` does
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

Introspection and suggestions are enforced only on the default validation path: a plugin's
`setValidationFn`, or an `onValidate` that sets `out.errors` (even `[]`), bypasses them. That is
the plugin trust model: a plugin runs with the server's authority.

When `NODE_ENV` is unset both default to on, so set `NODE_ENV=production` (or
`introspection: false` and `suggestions: false`) in production.

`NODE_ENV` is read once, when `createGraxia` runs. Set `introspection: true` or
`suggestions: true` to keep them in production.
