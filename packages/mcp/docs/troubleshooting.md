# Troubleshooting

## 403 `Origin https://… is not allowed.`

A browser client sent an `Origin` that is not the endpoint's own. Add it to `allowedOrigins`:

```ts
createMcp(graxia, {
	schema,
	name: 'library',
	allowedOrigins: ['https://app.example'],
});
```

Behind a proxy the endpoint's own origin is the internal one in the request URL: list the public
origin too. A CLI or server client sends no `Origin` and is not affected.

## 405 `GET is not supported: this endpoint is stateless.`

The endpoint has no server-to-client stream and no sessions. Clients send `POST`; a client that
probes with `GET` or `DELETE` and goes on after the 405 is working as intended.

## 413 `The request body is larger than … bytes.`

Send a smaller request, or raise `maxBodyBytes` (keep it equal to graxia's `limits.bodyBytes`, or
the HTTP and MCP endpoints disagree).

## 415 `The request body must be application/json.`

Send `Content-Type: application/json`.

## `Cannot query field "x" on type "Y"` for a field that exists

The field is behind `@needs` and `can` says the caller lacks the permission, or `can` is not what
you meant: the view is built from `can`'s answer. Check it with `graphql_schema` as that caller.

## `graphql_mutate` is not found

It is listed only with `mutations: true`.

## Every query is refused with a trusted-documents error

`trustedDocuments` is `strict` (the default under `NODE_ENV=production`): graxia refuses any
document outside the manifest, so an agent cannot send arbitrary queries. Persisted operations as
typed tools are on the [roadmap](./roadmap.md).

## `The server failed to run the operation`

An unexpected failure inside the tool; its cause is not sent. Check the server logs
(graxia's `onUnexpected`).
