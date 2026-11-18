# @graxia/redis

## 0.1.0

### Minor Changes

- [#52](https://github.com/softistx/graxia/pull/52) [`a5511e7`](https://github.com/softistx/graxia/commit/a5511e7c865f0c89728ff032ad84b871d3f7554e) Thanks [@SteveGT96](https://github.com/SteveGT96)! - Redis PubSub and cache on Bun's Redis client: `redisPubSub` (the `PubSub` contract across processes, one shared SUBSCRIBE per topic, resubscribe on reconnect, `ready()`) and `redisCache` (the `KeyValueCache` contract with `PX` expiry).

### Patch Changes

- Updated dependencies [[`a5511e7`](https://github.com/softistx/graxia/commit/a5511e7c865f0c89728ff032ad84b871d3f7554e), [`a5511e7`](https://github.com/softistx/graxia/commit/a5511e7c865f0c89728ff032ad84b871d3f7554e), [`a5511e7`](https://github.com/softistx/graxia/commit/a5511e7c865f0c89728ff032ad84b871d3f7554e), [`a5511e7`](https://github.com/softistx/graxia/commit/a5511e7c865f0c89728ff032ad84b871d3f7554e), [`a5511e7`](https://github.com/softistx/graxia/commit/a5511e7c865f0c89728ff032ad84b871d3f7554e), [`a5511e7`](https://github.com/softistx/graxia/commit/a5511e7c865f0c89728ff032ad84b871d3f7554e)]:
  - @graxia/core@0.2.0
