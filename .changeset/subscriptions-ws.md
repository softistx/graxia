---
'@graxia/core': minor
---

Subscriptions over WebSocket (graphql-transport-ws): `subscriptions.ws` (`connectionInitWaitTimeout`, `keepAliveMs`, `maxPayloadBytes`, `onConnect`, `onDisconnect`), wired by `serve()`, `graxia.upgrade(request, server)` and `graxia.websocket` for your own `Bun.serve`; `dispose()` closes sockets with 1001. `createGraxia`'s serve and fetch wiring moved to its own module.
