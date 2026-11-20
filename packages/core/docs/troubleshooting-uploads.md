# Troubleshooting: file uploads

Every message of [File uploads](./guide/uploads.md), headed by the text the server sends. The rest is in
[Troubleshooting](./troubleshooting.md).

## uploads.bodyBytes must be a positive integer

`uploads.bodyBytes` is not an integer of at least 1 (`GraxiaConfigError` at boot).
Pass a size such as `uploads: { bodyBytes: 16 << 20 }`.

## uploads.files must be a positive integer

`uploads.files` is not an integer of at least 1 (`GraxiaConfigError` at boot). Pass a count such as
`uploads: { files: 10 }`.

## uploads must be a boolean or an object ({ bodyBytes, fileBytes, files })

`uploads` was given something else, such as a string or a number (`GraxiaConfigError` at boot). Use `true`, `false`,
or an object of limits: `uploads: { bodyBytes: 16 << 20, fileBytes: 8 << 20, files: 10 }`.

## uploads.fileBytes must be a positive integer no larger than uploads.bodyBytes

The per-file limit is not an integer of at least 1, or it is above `uploads.bodyBytes`.

```ts
createGraxia({ schema, uploads: { bodyBytes: 16 << 20, fileBytes: 8 << 20 } });
```

## uploads need CSRF prevention: a browser can post multipart/form-data cross-site without a preflight. Keep csrf.requireHeader on (the default), or turn uploads off.

`createGraxia` refuses `uploads` together with `csrf: false` or `csrf: { requireHeader: false }`: a browser
can post `multipart/form-data` cross-site without a preflight. Keep `csrf.requireHeader` on (the default),
or turn uploads off.

```ts
createGraxia({ schema, uploads: true }); // the CSRF header is required (default)
```

## File uploads (multipart/form-data) are not enabled on this server. (`UPLOADS_NOT_ENABLED`)

**Status 415.** A multipart body reached a server without `uploads`. Send JSON, or enable it:
`createGraxia({ uploads: true })`.

## The request body is larger than uploads.bodyBytes (N bytes). (`UPLOAD_TOO_LARGE`)

**Status 413.** The whole multipart body is over `uploads.bodyBytes` (16 MiB by default). Send less, or raise the limit.

## File "0" is larger than uploads.fileBytes (N bytes). (`UPLOAD_TOO_LARGE`)

**Status 413.** One file is over `uploads.fileBytes` (8 MiB by default). `"0"` is the file's field name in `map`.
Send a smaller file, or raise `uploads.fileBytes` (never above `uploads.bodyBytes`).

## The "operations" field is larger than limits.bodyBytes (N bytes). (`UPLOAD_TOO_LARGE`)

**Status 413.** The JSON `operations` part is over `limits.bodyBytes` (1 MiB by default), however small the files are.
Send a shorter document (a persisted `documentId` helps), or raise `limits.bodyBytes`.

## The request holds N files; uploads.files allows M. (`UPLOAD_TOO_MANY_FILES`)

**Status 413.** The `fix` says: send fewer files per request, or raise `uploads.files` on the server.

## The multipart body could not be parsed. (`UPLOAD_INVALID`)

**Status 400.** The body is not valid `multipart/form-data`: a missing or wrong boundary in the `Content-Type`, a
truncated body, or a body that could not be read. Let the HTTP client set the `Content-Type` (with its
boundary) itself.

## The multipart request has two file parts named "0". (`UPLOAD_INVALID`)

**Status 400.** Two file parts share one field name (`0` here), so the server cannot tell which file a `map` path
means. Give each file part its own name, as in `map`: `{ "0": ["variables.a"], "1": ["variables.b"] }`, and send the
parts as `-F 0=@a.txt -F 1=@b.txt`. One file for several paths is one part with several paths in its `map` entry.

## The multipart request has no "operations" field. (`UPLOAD_INVALID`)

**Status 400.** Send `operations` first: a JSON text field holding the GraphQL request (`{ "query", "variables" }`), with
`null` where each file goes. The same code answers `The multipart request has no "map" field.`.

## The "operations" field is not valid JSON. (`UPLOAD_INVALID`)

**Status 400.** `operations` must be JSON text, not a file part.

## The "map" field must be a JSON object of file field names to arrays of paths. (`UPLOAD_INVALID`)

**Status 400.** `map` is `{ "0": ["variables.file"] }`: each file part's field name and the non-empty list of paths
that receive it.

## Map entry "0" points at "query"; a file may only go under "variables". (`UPLOAD_INVALID`)

**Status 400.** A path must start with `variables` (`1.variables.file` in a batch, with the entry index). `query`,
`operationName` and `extensions` are refused.

## Map entry "0" points at "variables.f", which is not null in "operations". (`UPLOAD_INVALID`)

**Status 400.** The slot a path names must exist and be `null` in `operations`: write `"variables": { "f": null }`.
A path may not go through a value that is not an object or an array.

## Map entry "0" path "variables.`__proto__`" is not allowed. (`UPLOAD_INVALID`)

**Status 400.** `__proto__`, `constructor` and `prototype` are never followed in a path.

## Map entry "0" has no file part. (`UPLOAD_INVALID`)

**Status 400.** `map` names a field that is not a file part of the request (it is missing, or a text field).
The reverse, `File part "1" is not in "map".`, is the same mistake: every file part needs a `map` entry.

## File must be sent as a file part of a multipart request (GraphQL multipart request spec).

`GraphQLFile` refused a value that is not a `File`: a JSON request sent a string for a `File` argument, or a
literal was written in the document. Send the file as a multipart part.
