---
'@graxia/redis': minor
---

BREAKING (pre-1.0): `redisPubSub` follows `@graxia/core`'s PubSub in Yoga's shape (needs the matching core minor): tuple topics, `subscribe(topic, id?)`, `publish(topic, id?, payload)`, no `{ signal }` argument (the iterator is returned when the operation stops). A topic with an id is the Redis channel `<prefix>topic:id`, unchanged on the wire. `subscriberCount(topic, id?)` takes the id. Migration: `subscribe('post:42', { signal })` → `subscribe('post', '42')`, and the topic type `{ [k: \`post:${string}\`]: Post }` → `{ post: [id: string, payload: Post] }`.
