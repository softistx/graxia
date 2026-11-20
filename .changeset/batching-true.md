---
'@graxia/core': patch
---

`batching: true` is accepted and means `{ limit: 10 }`, Yoga's default, as the migration guide already said. A bad `batching` value now throws a `GraxiaConfigError` naming the accepted forms (`true`, `false` or `{ limit: <positive integer> }`).
