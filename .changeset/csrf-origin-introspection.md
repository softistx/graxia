---
'@graxia/core': minor
---

CSRF prevention, same-origin checks, a WebSocket Origin check, and introspection and suggestions off in production: new `csrf` (`requireHeader`, `sameOrigin`), `introspection` and `suggestions` options and `DEFAULT_CSRF_HEADERS`. **Breaking**: a `GET` or a non-JSON `POST` without one of the CSRF headers is refused with 403 `CSRF_HEADER_REQUIRED` (`csrf: { requireHeader: false }` turns it off), which includes a browser `EventSource` (it cannot set headers): use `graphql-sse`, or `requireHeader: false` with `sameOrigin` on; a WebSocket upgrade from another origin is refused with 403 `FORBIDDEN_ORIGIN` unless listed in `csrf.sameOrigin.allowedOrigins`; under `NODE_ENV=production` introspection and "Did you mean" suggestions are off unless set to `true`.
