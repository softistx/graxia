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
