import type { CacheSetOptions, KeyValueCache } from '@graxia/core';
import {
	type BoundRawCache,
	bindRawCache,
	defineRawCache,
} from '@softistx/redis';
import { type RedisConnection, resolveLink } from './connection';

/** Options of {@link redisCache}. */
export type RedisCacheOptions = RedisConnection & {
	/**
	 * Prepended to every key, `:` included: `graxia:cache` and `graxia:cache:`
	 * both store `graxia:cache:<key>`. Default `graxia:cache:`.
	 */
	prefix?: string;
};

/**
 * A {@link KeyValueCache} on a `@softistx/redis` raw cache: values are
 * strings, a `ttlMs` becomes a `PX` expiry. `dispose()` lets go of the shared
 * client only when the cache opened it (`url`); a `client` you passed stays
 * open.
 *
 * @example
 * const cache = redisCache({ url: process.env.REDIS_URL });
 * await cache.set('k', 'v', { ttlMs: 60_000 });
 * await cache.get('k'); // 'v'
 */
export function redisCache(
	options: RedisCacheOptions = {},
): KeyValueCache<string> {
	const link = resolveLink(options);
	const name = (options.prefix ?? 'graxia:cache:').replace(/:$/, '');
	const definition = defineRawCache({ name });
	let bound: Promise<BoundRawCache> | undefined;
	const cache = (): Promise<BoundRawCache> =>
		(bound ??= link.client().then(
			(client) => bindRawCache(client, definition),
			(error: unknown) => {
				bound = undefined;
				throw error;
			},
		));
	return {
		async get(key) {
			return (await cache()).get(key);
		},
		async set(key, value, setOptions: CacheSetOptions = {}) {
			const ttl = setOptions.ttlMs;
			const valid = ttl !== undefined && Number.isFinite(ttl) && ttl > 0;
			await (await cache()).set(
				key,
				value,
				valid ? { ttlMs: Math.ceil(ttl) } : {},
			);
		},
		async delete(key) {
			return (await cache()).delete(key);
		},
		dispose: () => link.release(),
	};
}
