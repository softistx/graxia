# @graxia/graphiql

The [GraphiQL](https://github.com/graphql/graphiql) 4 page for graxia, bundled at build time: it runs
under a strict content security policy, with no CDN, no external font and no analytics.

> Status: first slice of the explorer effort, unreleased (first publish 0.1.0). Apollo Sandbox follows.
> **Development only**: the page is off when `NODE_ENV` is `production`.

## Install

```sh
bun add @graxia/graphiql @graxia/core
```

A normal dependency, not `-d`: the plugin is off in production by default, so it can stay in
`dependencies`; the bundle costs disk only.

The packages are ESM, built for Bun, and resolve with `"moduleResolution": "bundler"` in your
`tsconfig.json`. `nodenext` is not supported. The package has no runtime dependency besides the
`@graxia/core` peer: GraphiQL, React and the clients are inside the shipped bundle.

## Use

```ts
import { createGraxia } from '@graxia/core';
import { graphiql } from '@graxia/graphiql';

// `schema` is the one from the core quick start
const graxia = createGraxia({ schema, plugins: [graphiql()] });
graxia.serve({ port: 3000 }); // open http://localhost:3000/graphql in a browser
```

Open the endpoint in a browser: a `GET` that accepts `text/html` and has no `query` gets the page.
Every other request (a JSON `GET`, a `POST`, a WebSocket) is the normal GraphQL endpoint. With
`csrf.sameOrigin` on, a cross-site or foreign-`Origin` request for the page is refused like any
other request; a same-origin navigation passes.

> **`headers` are rendered into the HTML**: put no secret in them.

## Options

| Option                 | Default                     | What                                                                                            |
| ---------------------- | --------------------------- | ----------------------------------------------------------------------------------------------- |
| `enabled`              | `NODE_ENV !== 'production'` | `false`: no hooks, nothing is served. `true` in production is a risk.                           |
| `title`                | `"GraphiQL"`                | The page title.                                                                                 |
| `defaultQuery`         | GraphiQL's own              | The query the editor starts with.                                                               |
| `headers`              | none                        | Initial content of the headers editor (an object, shown as JSON).                               |
| `shouldPersistHeaders` | `false`                     | Keep the headers editor in local storage.                                                       |
| `subscriptions`        | detected                    | `'ws'` if the instance's WebSocket is on, else `'sse'`, else `false`. Set it only to force one. |

## Content security policy

The page is served with `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' data:; font-src 'self' data:; connect-src 'self'; worker-src 'none'; frame-ancestors
'none'; base-uri 'none'; form-action 'none'` (plus the same-host `ws(s)://` origin with
`subscriptions: 'ws'`), `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` and
`Cache-Control: no-store`. Scripts never need `'unsafe-inline'`; GraphiQL 4 sets inline styles at run
time, hence `'unsafe-inline'` for styles only. See [the guide](./docs/guide/graphiql.md).

## Documentation

See [`docs/`](./docs): the [guide](./docs/guide/graphiql.md), [troubleshooting](./docs/troubleshooting.md)
and [roadmap](./docs/roadmap.md).
