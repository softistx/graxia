---
'@graxia/core': minor
---

Multipart file uploads (the GraphQL multipart request spec), behind a new `uploads` option that is off by default: `createGraxia({ schema, uploads: true })` reads `operations`, `map` and one part per file, under `uploads.bodyBytes` (16 MiB), `uploads.fileBytes` (8 MiB) and `uploads.files` (10), and hands resolvers Bun's Web `File` through the new `GraphQLFile` scalar. A multipart request always needs the CSRF header, and `createGraxia` refuses `uploads` with that check off. New error codes `UPLOADS_NOT_ENABLED`, `UPLOAD_TOO_LARGE`, `UPLOAD_TOO_MANY_FILES` and `UPLOAD_INVALID`. A server without `uploads` is unchanged, except that a multipart POST now answers 415 `UPLOADS_NOT_ENABLED` instead of an untyped 415 (it was a 403 without the CSRF header, as before).

A resolver can annotate concrete argument types, such as `({ file }: { file: File })`.
