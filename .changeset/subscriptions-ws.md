---
'@graxia/core': minor
---

Subscriptions over WebSocket (graphql-transport-ws): `subscriptions.ws` (`connectionInitWaitTimeout`, `keepAliveMs`, `maxPayloadBytes`, `onConnect`, `onDisconnect`), wired by `serve()`, `graxia.isUpgrade(request)`, `graxia.upgrade(request, server)` (resolves `undefined` once upgraded, else the refusal `Response`) and `graxia.websocket` for your own `Bun.serve`; `serve()` now returns `Bun.Server<GraxiaSocketData>`; `dispose()` closes sockets with 1001. `createGraxia`'s serve and fetch wiring moved to its own module.
