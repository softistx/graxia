# Apollo Sandbox

`apolloSandbox()` is a graxia plugin that serves [Apollo Sandbox](https://www.apollographql.com/docs/graphos/platform/sandbox)
from the GraphQL endpoint, pointed at that same endpoint. Unlike [`graphiql()`](./graphiql.md), it is
**not self-contained**: the page loads Apollo's embed script from Apollo's CDN, and the Sandbox
itself runs in an Apollo-hosted iframe.

```ts
import { createGraxia } from '@graxia/core';
import { apolloSandbox } from '@graxia/graphiql';

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

| Option                        | Default                     | What                                                                  |
| ----------------------------- | --------------------------- | --------------------------------------------------------------------- |
| `enabled`                     | `NODE_ENV !== 'production'` | `false`: no hooks, nothing is served. `true` in production is a risk. |
| `title`                       | `"Apollo Sandbox"`          | The page title.                                                       |
| `initialState.document`       | Sandbox's own               | The operation the editor starts with.                                 |
| `initialState.variables`      | none                        | The variables (an object).                                            |
| `initialState.headers`        | none                        | The request headers (rendered into the HTML).                         |
| `initialState.includeCookies` | `false`                     | Send cookies with the Sandbox's requests.                             |

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
style-src 'self'; img-src data:; connect-src 'self';
frame-src https://sandbox.embed.apollographql.com;
frame-ancestors 'none'; base-uri 'none'; form-action 'none'
```

The same headers as the GraphiQL page: `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`,
`Cache-Control: no-store`. The exact value is exported as `SANDBOX_CSP`.

| Host                                               | Directive    | Why                                                                          |
| -------------------------------------------------- | ------------ | ---------------------------------------------------------------------------- |
| `https://embeddable-sandbox.cdn.apollographql.com` | `script-src` | Serves `embeddable-sandbox.umd.production.min.js`, which creates the iframe. |
| `https://sandbox.embed.apollographql.com`          | `frame-src`  | The Sandbox UI, in an iframe.                                                |

No wildcard. `connect-src 'self'` is the page itself running the Sandbox's requests against your
endpoint (the iframe asks the page through `postMessage`), so no WebSocket origin is needed. Styles
need no `'unsafe-inline'`: the script is told not to set inline styles (`allowDynamicStyles: false`)
and the bootstrap styles the page with a constructed stylesheet. `img-src data:` is for an empty
favicon, so the embed script does not fetch one from Apollo.

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
count: pick one with the option.

```ts
plugins: [
	graphiql({ enabled: process.env['EXPLORER'] !== 'sandbox' }),
	apolloSandbox({ enabled: process.env['EXPLORER'] === 'sandbox' }),
];
```

## Enabling it in production

`enabled: true` serves the page whatever `NODE_ENV` is. It is a risk (see above): a third-party
script on your API's origin, on a page that invites schema exploration (introspection is off in
production in core). Keep it behind your own authentication, or leave it development only.

See also [troubleshooting](../troubleshooting.md#apollo-sandbox).
