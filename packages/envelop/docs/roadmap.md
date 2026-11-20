# Roadmap

Where `@graxia/envelop` is going, as what you get. A direction, not a commitment.

## Later

- **Envelop context identity** — keep one context object across the hooks of an operation, so `@policy` of
  `@envelop/generic-auth` can work.
- **Access to `serverContext`** in the Envelop context.

## Not planned

- graphql-yoga plugins; graxia's own plugins replace them.
- Envelop `instrumentation`; use graxia's telemetry.

## Shipped

### 0.1.0

- **`fromEnvelop(plugins)`** — built and tested with `@envelop/depth-limit`, `@envelop/generic-auth`,
  `@envelop/response-cache` and `@envelop/persisted-operations` on graphql 17.
