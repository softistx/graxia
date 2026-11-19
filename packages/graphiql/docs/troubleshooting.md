# Troubleshooting

## The page is blank

The browser blocked the script or the style under the CSP, or never received them. Open the console:
a `Refused to load…` message names the directive. Usual causes: a proxy that rewrites or adds its own
`Content-Security-Policy`, or one that strips query strings (the assets are `?graphiql-asset=…`).
Check that `GET /graphql?graphiql-asset=<file>` answers 200 with `Content-Type` `text/javascript`.

## 404 on `?graphiql-asset=…`

Only the names in `dist/assets/manifest.json` are served. A page cached from an older build links
hashed files that no longer exist: reload without the cache. A 404 on every asset after a deploy means
the package was installed without its `dist/assets/` (check `files` in a custom bundle step).

## GraphiQL assets not found at …

The plugin throws this on the first page request when `dist/assets/manifest.json` is missing: the
installed `@graxia/graphiql` has no `dist/assets`. Reinstall the package; in the graxia repository,
run `bun run build`.

## 403 `CSRF_HEADER_REQUIRED` when opening the page

The page `GET` is exempt from the CSRF header only through `csrfExempt`, which needs `@graxia/core` 0.4
or later, and only with `Accept: text/html` and no `query`. Upgrade core, or check that the request
is the browser's navigation and not a script. See core's
[troubleshooting](../../core/docs/troubleshooting.md).

## The page loads but shows no schema

GraphiQL reads the schema through introspection. Core turns it off in production and when
`introspection: false`: enable it while developing, or paste the schema in your tooling.

## The page does not open

`enabled` defaults to `NODE_ENV !== 'production'`. A production process, or a host that sets
`NODE_ENV=production` locally, serves nothing; the request falls through to the endpoint's normal
answer.

## Apollo Sandbox

### The Sandbox page is blank

The browser could not load Apollo's embed script or its iframe. Open the console: a `Refused to load…`
message means a proxy replaced or added a `Content-Security-Policy` (the page needs `script-src`
`https://embeddable-sandbox.cdn.apollographql.com` and `frame-src` `https://sandbox.embed.apollographql.com`); a
network error means the two hosts are blocked (offline, a firewall, an ad blocker). An error
`the Apollo embed script did not load` from `?apollo-sandbox-asset=…` says the same. Use `graphiql()` where
the hosts are unreachable.

### The Sandbox cannot reach the endpoint

The page makes the requests itself, so they are same-origin and need no CORS. If they fail, check that
the endpoint it shows is the right one (behind a proxy, the browser URL is what counts, without its
query) and that `csrf` is not refusing them: the Sandbox sends the GraphQL request as a normal `POST`
with a JSON body. Cookies are sent only with `initialState.includeCookies: true` or the toggle in the
Sandbox's connection settings.

### `graphiql() and apolloSandbox() are both enabled`

Both explorers answer the same `GET`. Install one, or disable the other (`enabled: false`). See
[the guide](./guide/apollo-sandbox.md#with-graphiql).
