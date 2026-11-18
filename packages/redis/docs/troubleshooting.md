# Troubleshooting

The errors a consumer can hit, headed by the message as it appears.

## @graxia/redis: pass either "url" or "client", not both

`redisPubSub` or `redisCache` received both `url` and `client` (a `GraxiaConfigError`). Pass a `url` and
the adapter owns its connection, or pass your `client` and you own it.

```ts
redisPubSub({ url: process.env.REDIS_URL }); // or
redisPubSub({ client: myRedisClient });
```

## Connection closed (`ERR_REDIS_CONNECTION_CLOSED`)

Redis is unreachable (wrong `url`, server down, connection refused). Bun's `RedisError` (code
`ERR_REDIS_CONNECTION_CLOSED`) says `Connection has failed`, `Connection closed`, or
`Max reconnection attempts reached` once it has retried `maxRetries` times
(default 20). `publish()` and the cache methods reject with it; for `redisPubSub` the same error also
reaches `onError`, since the subscriber connection fails too. Check the `url` (or `REDIS_URL`) and that
the server listens there.

## Subscriptions stop after a Redis outage

Bun reconnects on its own and `redisPubSub` subscribes again, but after `maxRetries` (default 20)
Bun gives up and reports through `onclose`; the error reaches your `onError`. Events published
while disconnected are lost. Create the `RedisClient` yourself with a larger `maxRetries` and pass
it as `client`, or restart the instance when `onError` reports a closed connection.

## A subscriber misses the first event

Another process published in the short window before Redis registered `SUBSCRIBE`. Await
`pubsub.ready()` before telling publishers to start; on the same instance `publish` already waits.
