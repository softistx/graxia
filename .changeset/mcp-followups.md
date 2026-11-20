---
'@graxia/mcp': patch
---

The typed-tools internals no longer use `any` for the host context. The operations guide now says what a manifest that yields no tool does, that a throwing `can` leaves the typed tools out of `tools/list`, and that GraphQL Code Generator's client preset drops operation descriptions (use `descriptions`).
