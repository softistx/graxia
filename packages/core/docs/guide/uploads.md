# File uploads

`@graxia/core` accepts the [GraphQL multipart request spec](https://github.com/jaydenseric/graphql-multipart-request-spec)
(`operations`, `map`, one part per file). It is off by default.

```ts
import { createGraxia, createSchema, GraphQLFile } from '@graxia/core';

const schema = createSchema()({
	typeDefs: `
		scalar File
		type Query { ok: Boolean }
		type Mutation { upload(file: File!): String! }
	`,
	resolvers: {
		File: GraphQLFile,
		Mutation: {
			upload: async (_parent, args) => {
				const file = args['file'] as File;
				return `${file.name}: ${(await file.text()).length}`;
			},
		},
	},
});

createGraxia({ schema, uploads: true }).serve();
```

```sh
curl localhost:3000/graphql -H 'x-graphql-csrf: 1' \
  -F operations='{"query":"mutation($f: File!){ upload(file: $f) }","variables":{"f":null}}' \
  -F map='{"0":["variables.f"]}' -F 0=@a.txt
```

## The `File` a resolver gets

Each file reaches the resolver as Bun's Web `File` (`name`, `type`, `size`, `text()`, `arrayBuffer()`,
`stream()`), set into `variables` at each path the `map` names. One file may fill several paths, in
lists and nested inputs too.

`GraphQLFile` is the scalar to register for `scalar File`. It accepts only a `File`: a JSON request that
sends a string where a file is due, and an inline literal, are refused with
`File must be sent as a file part of a multipart request (GraphQL multipart request spec).`
It is input only. With graphql-codegen, map the scalar with `scalars: { File: 'File' }` to type the
argument. A schema that names the scalar `Upload` (Apollo, graphql-upload) wraps it:

```ts
import { GraphQLScalarType } from 'graphql';
const Upload = new GraphQLScalarType({
	...GraphQLFile.toConfig(),
	name: 'Upload',
});
```

## Limits

```ts
createGraxia({
	schema,
	uploads: { bodyBytes: 16 << 20, fileBytes: 8 << 20, files: 10 },
});
```

| Option              | Default | Refusal                                                    |
| ------------------- | ------- | ---------------------------------------------------------- |
| `uploads.bodyBytes` | 16 MiB  | 413 `UPLOAD_TOO_LARGE`, the whole body                     |
| `uploads.fileBytes` | 8 MiB   | 413 `UPLOAD_TOO_LARGE`, one file (never above `bodyBytes`) |
| `uploads.files`     | 10      | 413 `UPLOAD_TOO_MANY_FILES`                                |

The `operations` field stays under `limits.bodyBytes` (1 MiB). `Content-Length` is checked first, then
the stream is counted and cancelled the moment it passes `uploads.bodyBytes`, whatever the header said.
A refused upload never reaches a resolver.

**Memory.** The body is buffered (up to `uploads.bodyBytes`, plus a copy while it is joined) and parsed by
Bun before the operation runs, so each upload in flight costs up to about twice `bodyBytes` of memory.
Size the limits for your concurrency. Streaming each part to disk or S3 without buffering is on the
[roadmap](../roadmap.md).

## CSRF

A `multipart/form-data` POST is a "simple" request a browser sends cross-site without a preflight, so it
always needs the CSRF header (`x-graphql-csrf: 1`, or any of `csrf.requireHeader`), checked before the body
is read. `createGraxia` refuses `uploads` together with `csrf: false` or `csrf: { requireHeader: false }`
at boot (`GraxiaConfigError`). Apollo's `createUploadLink` and urql's `multipartFetchExchange` take
`headers: { 'x-graphql-csrf': '1' }`.

## Batching, trusted documents, plugins

- `operations` may be an array when `batching` is on; map paths then start with the entry index
  (`0.variables.file`).
- The operations go through `onParams` like a JSON body: `strict` trusted documents refuse an arbitrary
  query and a multipart `operations` with a `documentId` works. Parse, validation and operation limits apply.
- WebSocket carries no files. The answer may be JSON, SSE or `multipart/mixed` per `Accept`.
- `graxia.execute` sends variables as JSON, so it cannot carry a `File`: test uploads through `graxia.fetch`.

## Testing

```ts
const body = new FormData();
body.set(
	'operations',
	JSON.stringify({
		query: 'mutation($f: File!){ upload(file: $f) }',
		variables: { f: null },
	}),
);
body.set('map', JSON.stringify({ 0: ['variables.f'] }));
body.set('0', new File(['hello'], 'a.txt'));
const response = await graxia.fetch(
	new Request('http://x/graphql', {
		method: 'POST',
		headers: { 'x-graphql-csrf': '1' },
		body,
	}),
);
```

## Coming from other servers

- **graphql-yoga**: the same Web `File`; `scalar File` and `GraphQLFile` replace the built-in.
- **graphql-upload**: there is no `createReadStream`; use `file.stream()`, `file.arrayBuffer()` or `file.text()`.

## Refusals

| Status | Code                    | When                                                             |
| ------ | ----------------------- | ---------------------------------------------------------------- |
| 415    | `UPLOADS_NOT_ENABLED`   | multipart body, `uploads` off                                    |
| 413    | `UPLOAD_TOO_LARGE`      | body, a file or `operations` over its limit                      |
| 413    | `UPLOAD_TOO_MANY_FILES` | more files than `uploads.files`                                  |
| 400    | `UPLOAD_INVALID`        | a body or `map` that breaks the spec, a path outside `variables` |
| 403    | `CSRF_HEADER_REQUIRED`  | no CSRF header                                                   |

See [Troubleshooting](../troubleshooting.md) for each message.
