# GraphiQL

`graphiql()` is a graxia plugin that serves the GraphiQL 4 page from the GraphQL endpoint itself.

```ts
import { graphiql } from '@graxia/graphiql';

createGraxia({
	schema,
	plugins: [graphiql({ title: 'My API', subscriptions: 'ws' })],
});
```

## Serving model

The plugin answers in `onRequest`, on whatever path the host mounted graxia on; no extra route is
needed.

- **The page**: a `GET` whose `Accept` includes `text/html` and that has no `query`, `extensions` or
  `documentId` parameter. The HTML has no inline script and no inline config: a
  `<div id="graphiql" data-config="…">` (the JSON, attribute-escaped), a stylesheet and a module
  script.
- **The assets**: `GET <same path>?graphiql-asset=<file>`. Only the names the build manifest lists are
  served; anything else (`../`, a slash, an encoded dot, an unlisted file) is a 404.
- Everything else, a `POST`, a JSON `GET`, a WebSocket upgrade, is untouched.

Browsers send neither request with a CSRF header. The plugin declares `csrfExempt` (see
[core's Security guide](../../../core/docs/guide/security.md#exempting-a-plugins-own-get-requests)) for
exactly these two shapes of `GET`, and answers them itself. It needs `@graxia/core` 0.4 or later. The `Origin` check
stays on, and an exempt request no plugin answers is refused as before.

## Content security policy

| Directive                 | Value                                       |
| ------------------------- | ------------------------------------------- |
| `default-src`             | `'none'`                                    |
| `script-src`              | `'self'`                                    |
| `style-src`               | `'self' 'unsafe-inline'`                    |
| `img-src`, `font-src`     | `'self' data:`                              |
| `connect-src`             | `'self'`, plus `ws(s)://<host>` with `'ws'` |
| `worker-src`              | `'none'`                                    |
| `frame-ancestors`         | `'none'`                                    |
| `base-uri`, `form-action` | `'none'`                                    |

GraphiQL 4 writes inline styles at run time, so styles need `'unsafe-inline'`; scripts do not. The
page also sends `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` and `Cache-Control: no-store`.
Nothing is loaded from another origin: the build bundles GraphiQL, React, the GraphQL parser and the
subscription clients into two hashed files.

## Assets and caching

`dist/assets/` holds `main-<hash>.js`, `main-<hash>.css`, their `.gz` variants and `manifest.json`.
Assets are served with `Cache-Control: public, max-age=31536000, immutable` (the name carries the
hash), the right `Content-Type`, `X-Content-Type-Options: nosniff`, and the gzip variant with
`Content-Encoding: gzip` and `Vary: Accept-Encoding` when the client accepts it. The bundle is about
3 to 5 MB raw (see the package's release notes for the exact size).

## Subscriptions

The plugin cannot read the instance's `ws` and `sse` settings, so choose with `subscriptions`:

- `'sse'` (default): subscriptions are sent as a `POST` and read as `text/event-stream`, the
  graphql-sse distinct connections mode core speaks.
- `'ws'`: graphql-transport-ws on the same path; the CSP gains the same-host `ws(s)://` origin.
- `false`: queries and mutations only.

## Behind a proxy or on a sub-path

Asset links are relative (`?graphiql-asset=…`), so a sub-path works as long as the proxy keeps the
query string and does not rewrite the response's CSP. A proxy that sets its own
`Content-Security-Policy` can block the page (see [troubleshooting](../troubleshooting.md)).

## Enabling it in production

`enabled: true` serves the page whatever `NODE_ENV` is. It is a risk: the page itself is harmless,
but it invites schema exploration, and the schema is only visible when introspection is on (core turns
it off in production). Keep it behind your own authentication, or leave it development only.
