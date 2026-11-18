import type { CacheSetOptions, KeyValueCache } from '@graxia/core';
import {
	closeQuietly,
	type RedisConnection,
	resolveClient,
} from './connection';

/** Options of {@link redisCache}. */
export type RedisCacheOptions = RedisConnection & {
	/** Prepended to every key. Default `graxia:cache:`. */
	prefix?: string;
};

/**
 * A {@link KeyValueCache} on Redis: values are strings, a `ttlMs` becomes a
 * `PX` expiry. `dispose()` closes the client only when the cache created it
 * (`url`); a `client` you passed stays open.
 *
 * @example
 * const cache = redisCache({ url: process.env.REDIS_URL });
 * await cache.set('k', 'v', { ttlMs: 60_000 });
 * await cache.get('k'); // 'v'
 */
export function redisCache(
	options: RedisCacheOptions = {},
): KeyValueCache<string> {
	const { client, owned } = resolveClient(options);
	const prefix = options.prefix ?? 'graxia:cache:';
	return {
		async get(key) {
			return (await client.get(prefix + key)) ?? undefined;
		},
		async set(key, value, setOptions: CacheSetOptions = {}) {
			const ttl = setOptions.ttlMs;
			if (ttl !== undefined && Number.isFinite(ttl) && ttl > 0)
				await client.set(prefix + key, value, 'PX', Math.ceil(ttl));
			else await client.set(prefix + key, value);
		},
		async delete(key) {
			return (await client.del(prefix + key)) > 0;
		},
		async dispose() {
			if (owned) closeQuietly(client);
		},
	};
}
