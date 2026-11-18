---
'@graxia/core': minor
---

Subscriptions over WebSocket (graphql-transport-ws): `subscriptions.ws` (`connectionInitWaitTimeout`, `keepAliveMs`, `maxPayloadBytes`, `onConnect`, `onDisconnect`), wired by `serve()`, `graxia.isUpgrade(request)`, `graxia.upgrade(request, server)` (resolves `undefined` once upgraded, else the refusal `Response`) and `graxia.websocket` for your own `Bun.serve`; `serve()` now returns `Bun.Server<GraxiaSocketData>`; `dispose()` closes sockets with 1001. `createGraxia`'s serve and fetch wiring moved to its own module.

Breaking: WebSocket is on by default, on the endpoint's path, and `serve()` returns `Bun.Server<GraxiaSocketData>`. An upgrade request was answered by the normal HTTP handling before; to keep that, pass `subscriptions: { ws: false }`. A cookie-authenticated browser app must also check `Origin` on the upgrade (see the README's "Security").
