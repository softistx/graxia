# GraphiQL

`graphiql()` is a graxia plugin that serves the GraphiQL 4 page from the GraphQL endpoint itself.

```ts
import { createGraxia } from '@graxia/core';
import { graphiql } from '@graxia/graphiql';

// `schema` is the one from the core quick start
const graxia = createGraxia({ schema, plugins: [graphiql()] });
graxia.serve({ port: 3000 });
```

Install it as a normal dependency (`bun add @graxia/graphiql`): the plugin is off in production by
default, so it can stay in `dependencies`; the bundle costs disk only.

Looking for Apollo Sandbox? See [its guide](./apollo-sandbox.md); the two cannot be enabled together.

## Options in one snippet

```ts
graphiql({
	title: 'My API',
	defaultQuery: '{ __typename }',
	// Rendered into the HTML: no secret here.
	headers: { 'x-tenant': 'demo' },
	shouldPersistHeaders: true,
	// Serve it in production too, behind the host's own auth (see the end of this page).
	enabled: true,
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
[core's Security guide](https://github.com/softistx/graxia/blob/develop/packages/core/docs/guide/security.md#exempting-a-plugins-own-get-requests)) for
exactly these two shapes of `GET`, and answers them itself. It needs `@graxia/core` 0.4 or later
(`api.transports` too). The `Origin` check stays on: with `csrf.sameOrigin`, a cross-site or
foreign-`Origin` request for the page is refused like any other request, and a same-origin
navigation passes. An exempt request no plugin answers is refused as before.

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
`Content-Encoding: gzip` and `Vary: Accept-Encoding` when the client accepts it. The bundle is two files: the script is 1.37 MB raw (446 KB gzip) and the stylesheet 413 KB raw
(273 KB gzip).

## `@defer` and `@stream`

GraphiQL sends `Accept: application/json, multipart/mixed`, and a query with `@defer` or `@stream` streams its
payloads into the response pane as they arrive. This needs `@graxia/core` 0.4 or later: older versions answered
`INCREMENTAL_NOT_SUPPORTED` because JSON was listed first. See core's
[incremental delivery](https://github.com/softistx/graxia/blob/develop/packages/core/docs/guide/incremental.md#which-accept-gets-what). `incremental: false` on
`createGraxia` turns it off.

## Subscriptions

The plugin reads the instance's `subscriptions.ws` and `subscriptions.sse` in `setup` (core's
`api.transports`), so there is nothing to set: `'ws'` if the WebSocket is on (core's default), else
`'sse'` if SSE is on, else `false`. Set `subscriptions` only to force one:

- `'sse'`: subscriptions are sent as a `POST` and read as `text/event-stream`, the
  graphql-sse distinct connections mode core speaks.
- `'ws'`: graphql-transport-ws on the same path; the CSP gains the same-host `ws(s)://` origin.
- `false`: queries and mutations only.

## Behind a proxy or on a sub-path

Asset links are relative (`?graphiql-asset=…`), so a sub-path works as long as the proxy keeps the
query string and does not rewrite the response's CSP. A proxy that sets its own
`Content-Security-Policy` can block the page (see [troubleshooting](../troubleshooting.md)).

## Deciding per request

`enabled` also takes a function `(request: Request) => boolean`. It is called for each `GET` the
explorer would answer (the page and its assets), and `false` falls through to the endpoint's normal
answer, exactly as `enabled: false` does. Use it when your dev flag is not `NODE_ENV`:

```ts
const myDevFlag = Bun.env['APP_ENV'] === 'dev';

createGraxia({ schema, plugins: [graphiql({ enabled: () => myDevFlag })] });
// or per caller: enabled: (request) => request.headers.get('x-staff') === '1'
```

The default stays `NODE_ENV !== 'production'`, so **an unset `NODE_ENV` serves the page**. Any value
that is neither a boolean nor a function throws a `GraxiaConfigError` at startup. A function counts as
enabled for the "two explorers" check, so disable the other one with `false`.

## Enabling it in production

`enabled: true` serves the page whatever `NODE_ENV` is. It is a risk: the page itself is harmless,
but it invites schema exploration, and the schema is only visible when introspection is on (core turns
it off in production). Keep it behind your own authentication, or leave it development only.
