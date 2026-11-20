# @softistx/graxia-graphiql

> Moved from `@graxia/graphiql`: see the [migration guide](https://github.com/softistx/graxia/blob/develop/packages/core/docs/guide/migrating-from-graxia-scope.md).

The [GraphiQL](https://github.com/graphql/graphiql) 4 page for graxia, bundled at build time: it runs
under a strict content security policy, with no CDN, no external font and no analytics.

The Apollo Sandbox option is the one exception: it loads Apollo's script and iframe (see below). Install one
explorer, not both.

> Since 0.1.0: `graphiql()` and `apolloSandbox()`.
> **Development only**: the page is off when `NODE_ENV` is `production`.

## Install

```sh
bun add @softistx/graxia-graphiql @softistx/graxia
```

A normal dependency, not `-d`: the plugin is off in production by default, so it can stay in
`dependencies`; the bundle costs disk only.

The packages are ESM, built for Bun, and resolve with `"moduleResolution": "bundler"` in your
`tsconfig.json`. `nodenext` is not supported. The package has no runtime dependency besides the
`@softistx/graxia` peer: GraphiQL, React and the clients are inside the shipped bundle.

## Use

```ts
import { createGraxia } from '@softistx/graxia';
import { graphiql } from '@softistx/graxia-graphiql';

// `schema` is the one from the core quick start
const graxia = createGraxia({ schema, plugins: [graphiql()] });
graxia.serve({ port: 3000 }); // open http://localhost:3000/graphql in a browser
```

Open the endpoint in a browser: a `GET` that accepts `text/html` and has no `query` gets the page.
Every other request (a JSON `GET`, a `POST`, a WebSocket) is the normal GraphQL endpoint. With
`csrf.sameOrigin` on, a cross-site or foreign-`Origin` request for the page is refused like any
other request; a same-origin navigation passes.

> **`headers` are rendered into the HTML**: put no secret in them.

An unset `NODE_ENV` is not `production`, so the page is served. A host with its own dev flag decides
per request (also on `apolloSandbox()`); only `true` serves, and any other value than a boolean or a
function throws a `GraxiaConfigError` at startup:

```ts
const myDevFlag = Bun.env['APP_ENV'] === 'dev';
graphiql({ enabled: () => myDevFlag });
```

## Options

| Option                 | Default                     | What                                                                                                                                                              |
| ---------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enabled`              | `NODE_ENV !== 'production'` | `false`: no hooks, nothing is served. A function `(request) => boolean` decides per request. `true` in production is a risk. An unset `NODE_ENV` serves the page. |
| `title`                | `"GraphiQL"`                | The page title.                                                                                                                                                   |
| `defaultQuery`         | GraphiQL's own              | The query the editor starts with.                                                                                                                                 |
| `headers`              | none                        | Initial content of the headers editor (an object, shown as JSON).                                                                                                 |
| `shouldPersistHeaders` | `false`                     | Keep the headers editor in local storage.                                                                                                                         |
| `subscriptions`        | detected                    | `'ws'` if the instance's WebSocket is on, else `'sse'`, else `false`. Set it only to force one.                                                                   |

## Content security policy

The page is served with `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' data:; font-src 'self' data:; connect-src 'self'; worker-src 'none'; frame-ancestors
'none'; base-uri 'none'; form-action 'none'` (plus the same-host `ws(s)://` origin with
`subscriptions: 'ws'`), `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` and
`Cache-Control: no-store`. Scripts never need `'unsafe-inline'`; GraphiQL 4 sets inline styles at run
time, hence `'unsafe-inline'` for styles only. See [the guide](./docs/guide/graphiql.md).

## Apollo Sandbox

```ts
import { apolloSandbox } from '@softistx/graxia-graphiql';

createGraxia({ schema, plugins: [apolloSandbox({ title: 'My API' })] });
```

Serves [Apollo Sandbox](https://www.apollographql.com/docs/graphos/platform/sandbox) the same way
(a browser `GET` on the endpoint, development only by default, `enabled` with the same meaning), but it
is **not self-contained**: it loads Apollo's embed script and iframe from two Apollo hosts, a third-party
script on your API's origin. Its CSP names only `https://embeddable-sandbox.cdn.apollographql.com`
(script) and `https://sandbox.embed.apollographql.com` (frame), and it runs subscriptions over WebSocket
when the instance has it on.

Options: `enabled`, `title`, `initialState` (`document`, `variables`, `headers`, `includeCookies`, default
`false`). `graphiql()` and `apolloSandbox()` cannot both be enabled on one instance: startup throws, so
pick one with `enabled`. The exact CSP (`sandboxContentSecurityPolicy`), the risks and the
troubleshooting are in [the guide](./docs/guide/apollo-sandbox.md).

## Documentation

See [`docs/`](./docs): the [GraphiQL guide](./docs/guide/graphiql.md), [Apollo Sandbox guide](./docs/guide/apollo-sandbox.md), [troubleshooting](./docs/troubleshooting.md)
and [roadmap](./docs/roadmap.md).
