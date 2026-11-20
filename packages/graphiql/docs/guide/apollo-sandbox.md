# Apollo Sandbox

`apolloSandbox()` is a graxia plugin that serves [Apollo Sandbox](https://www.apollographql.com/docs/graphos/platform/sandbox)
from the GraphQL endpoint, pointed at that same endpoint. Unlike [`graphiql()`](./graphiql.md), it is
**not self-contained**: the page loads Apollo's embed script from Apollo's CDN, and the Sandbox
itself runs in an Apollo-hosted iframe.

```ts
import { createGraxia } from '@softistx/graxia';
import { apolloSandbox } from '@softistx/graxia-graphiql';

// `schema` is the one from the core quick start
const graxia = createGraxia({ schema, plugins: [apolloSandbox()] });
graxia.serve({ port: 3000 }); // open http://localhost:3000/graphql in a browser
```

## Options

```ts
apolloSandbox({
	title: 'My API',
	initialState: {
		document: '{ __typename }',
		variables: { id: 1 },
		// Rendered into the HTML: no secret here.
		headers: { 'x-tenant': 'demo' },
		includeCookies: false, // the default
	},
	// Serve it in production too, behind the host's own auth (see below).
	enabled: true,
});
```

| Option                        | Default                     | What                                                                                                      |
| ----------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------- |
| `enabled`                     | `NODE_ENV !== 'production'` | `false`: no hooks. A function `(request) => boolean` decides per request. `true` in production is a risk. |
| `title`                       | `"Apollo Sandbox"`          | The page title.                                                                                           |
| `initialState.document`       | Sandbox's own               | The operation the editor starts with.                                                                     |
| `initialState.variables`      | none                        | The variables (an object).                                                                                |
| `initialState.headers`        | none                        | The request headers (rendered into the HTML).                                                             |
| `initialState.includeCookies` | `false`                     | Send cookies with the Sandbox's requests.                                                                 |

The endpoint shown in the Sandbox is the page's own URL without its query, and it is not editable.
Apollo's usage telemetry is switched off (`runTelemetry: false`).

## Serving model

Same as `graphiql()`: the plugin answers in `onRequest` on whatever path graxia is mounted on.

- **The page**: a `GET` whose `Accept` includes `text/html` and that has no `query`, `extensions` or
  `documentId` parameter. The HTML has no inline script and no inline style: a
  `<div id="sandbox" data-config="…">` (the JSON, attribute-escaped), Apollo's embed script and a
  small module script of the package.
- **The bootstrap**: `GET <same path>?apollo-sandbox-asset=<file>`, the hashed file the build manifest
  names (immutable caching, gzip). Anything else is a 404.
- Everything else, a `POST`, a JSON `GET`, a WebSocket upgrade, is untouched. `csrfExempt` covers only
  these two `GET`s, as for GraphiQL.

## Content security policy and the external hosts

```
default-src 'none'; script-src 'self' https://embeddable-sandbox.cdn.apollographql.com;
style-src 'self' 'unsafe-inline'; img-src data:; connect-src 'self';
frame-src https://sandbox.embed.apollographql.com;
frame-ancestors 'none'; base-uri 'none'; form-action 'none'
```

The same headers as the GraphiQL page: `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`,
`Cache-Control: no-store`. The value above is for an instance without WebSocket; with it, `connect-src` also holds the same-host
`ws(s)://` origin (see [Subscriptions](#subscriptions)). `sandboxContentSecurityPolicy(wsOrigin?)` returns it.

| Host                                               | Directive    | Why                                                                          |
| -------------------------------------------------- | ------------ | ---------------------------------------------------------------------------- |
| `https://embeddable-sandbox.cdn.apollographql.com` | `script-src` | Serves `embeddable-sandbox.umd.production.min.js`, which creates the iframe. |
| `https://sandbox.embed.apollographql.com`          | `frame-src`  | The Sandbox UI, in an iframe.                                                |

No wildcard. `connect-src 'self'` is the page itself running the Sandbox's requests against your
endpoint (the iframe asks the page through `postMessage`), so `'self'` is enough unless subscriptions run over WebSocket. Styles
hold `'unsafe-inline'`, as on the GraphiQL page: WebKit refuses a stylesheet Apollo's embed applies at run
time under `style-src 'self'`. Scripts stay `'self'` plus Apollo's host, and the bootstrap still styles the
page with a constructed stylesheet. `img-src data:` is for an empty
favicon, so the embed script does not fetch one from Apollo.

## Subscriptions

The Sandbox runs subscriptions from the page, not from the iframe. The plugin reads the instance's
transports in `setup`, like `graphiql()`:

- **WebSocket on** (core's default): the page passes `initialSubscriptionEndpoint`, the `ws(s)://`
  form of the endpoint URL (graphql-transport-ws on the same path), and the CSP's `connect-src` gains
  that same-host origin.
- **SSE only**: there are no subscriptions in the Sandbox, because Apollo's Sandbox does not speak
  graphql-sse. Use `graphiql()` for them.
- **`@defer` and `@stream`**: the Sandbox expects the `deferSpec=20220824` incremental format. It may
  not render graphql 17's incremental format; this is unverified.

## The risk of a third-party script

This is the one dependency of the package that is loaded at run time from outside:

- **Supply chain.** The script URL is `…/v2/…`, Apollo's major channel (the one Apollo Server pins):
  Apollo can change its content at any time, and it runs with full access to the page, whose origin is
  your API's. There is no Subresource Integrity attribute, because an SRI hash would break at
  each Apollo release; Apollo documents no immutable versioned URL. Treat the page as running code you
  do not control.
- **Privacy.** Loading the script and the iframe sends Apollo the visitor's IP address and `Referer`
  origin (the `Referrer-Policy` is `no-referrer`, which limits it), and the iframe is Apollo's page.
  Telemetry is off; the iframe is still Apollo's.
- **Availability.** Offline, or behind a firewall that blocks the two hosts, the page is blank. Use
  `graphiql()` there.

Hence development only by default.

## With `graphiql()`

Both plugins answer the same `GET`, so **two enabled explorers on one instance throw a
`GraxiaConfigError` at startup**. A disabled one (`enabled: false`, or production by default) does not
count: pick one with the option. The disabled plugin is named `<name> (disabled)`
(`apollo-sandbox (disabled)`, `graphiql (disabled)`), which is what keeps it from counting.

```ts
plugins: [
	graphiql({ enabled: process.env['EXPLORER'] !== 'sandbox' }),
	apolloSandbox({ enabled: process.env['EXPLORER'] === 'sandbox' }),
];
```

## Deciding per request

`enabled` also takes a function `(request: Request) => boolean`. It is called for each `GET` the
explorer would answer (the page and its assets), and `false` falls through to the endpoint's normal
answer, exactly as `enabled: false` does. Use it when your dev flag is not `NODE_ENV`:

```ts
const myDevFlag = Bun.env['APP_ENV'] === 'dev';

createGraxia({
	schema,
	plugins: [apolloSandbox({ enabled: () => myDevFlag })],
});
// or per caller: enabled: (request) => request.headers.get('x-staff') === '1'
```

The function must return `true` to serve: anything else, a `Promise` from an `async` function included, keeps the page closed. A function that throws is an unexpected error: the request answers 403 (no CSRF header) or a masked 500 (with it), and core reports it through `onUnexpected`.

The default stays `NODE_ENV !== 'production'`, so **an unset `NODE_ENV` serves the page**. Any value
that is neither a boolean nor a function throws a `GraxiaConfigError` at startup. A function counts as
enabled for the "two explorers" check, so disable the other one with `false`.

## Enabling it in production

`enabled: true` serves the page whatever `NODE_ENV` is. It is a risk (see above): a third-party
script on your API's origin, on a page that invites schema exploration (introspection is off in
production in core). Keep it behind your own authentication, or leave it development only.

See also [troubleshooting](../troubleshooting.md#apollo-sandbox).
