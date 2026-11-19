---
'@graxia/core': minor
---

BREAKING (pre-1.0): the PubSub has the shape of GraphQL Yoga's `createPubSub`. `createMemoryPubSub` becomes `createPubSub`; topics are tuples (`{ post: [id: string, payload: Post]; tick: [payload: number] }`); `subscribe(topic, id?)` and `publish(topic, id?, payload)` replace `` `post:${id}` `` template keys, and the `SubscribeOptions` argument is gone: the engine returns the subscription's iterator when the operation's signal aborts, so no `{ signal }` is passed (`bufferSize` is set on `createPubSub` only). `filterIterable` and `mapIterable` are removed for Yoga's `pipe`, `filter` and `map`. `subscriberCount(topic, id?)` takes the id. New types `PubSubPayload`, `PubSubSubscribeArgs`, `Operator`. Migration: `createMemoryPubSub<{ tick: number }>()` → `createPubSub<{ tick: [payload: number] }>()`; `subscribe(\`post:${id}\`, { signal })` → `subscribe('post', id)`; `filterIterable(src, fn)` → `pipe(src, filter(fn))`. See the PubSub guide.
