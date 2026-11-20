# Roadmap

Where `@softistx/graxia-graphiql` is going, as what you get. A direction, not a commitment.

## Now

- **Moving to the `@softistx` scope** — the package is now `@softistx/graxia-graphiql` (it was `@graxia/graphiql`). Same code and API; replace the dependency and the imports ([migration guide](https://github.com/softistx/graxia/blob/develop/packages/core/docs/guide/migrating-from-graxia-scope.md)). The old name is deprecated.

## Later

- GraphiQL 5 and later (Monaco editors with web workers): needs a CSP with workers and a heavier bundle.

## Not planned

- A CDN build of GraphiQL (the Apollo Sandbox option is the only explorer that loads from a CDN).

## Shipped

### 0.1.0

- **GraphiQL page** — GraphiQL 4 bundled for a strict CSP, no CDN, development only; the
  subscription transport is detected from the instance. See [the guide](./guide/graphiql.md).
- **Apollo Sandbox** — `apolloSandbox()`, Apollo's embeddable Sandbox on the endpoint, with a CSP
  naming only Apollo's two hosts, development only by default. See [the guide](./guide/apollo-sandbox.md).
