import {
	type CacheSetOptions,
	GraxiaConfigError,
	type KeyValueCache,
} from '@softistx/graxia';
import {
	type BoundRawCache,
	bindRawCache,
	defineRawCache,
} from '@softistx/redis';
import { type RedisConnection, resolveLink } from './connection';

/** Options of {@link redisCache}. */
export type RedisCacheOptions = RedisConnection & {
	/**
	 * Prepended to every key with exactly one trailing `:` (`graxia:cache` and
	 * `graxia:cache:` both store `graxia:cache:<key>`); at least one character
	 * must precede it. Default `graxia:cache:`.
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
	if (name.length === 0)
		throw new GraxiaConfigError(
			'@softistx/graxia-redis: redisCache prefix must hold at least one character before its ":"',
		);
	const definition = defineRawCache({ name });
	let bound: Promise<BoundRawCache> | undefined;
	const cache = (): Promise<BoundRawCache> => {
		if (!bound)
			bound = link.client().then((client) => bindRawCache(client, definition));
		const pending = bound;
		return pending.catch((error: unknown) => {
			if (bound === pending) bound = undefined;
			throw error;
		});
	};
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
				valid
					? { ttlMs: Math.min(Math.ceil(ttl), Number.MAX_SAFE_INTEGER) }
					: {},
			);
		},
		async delete(key) {
			return (await cache()).delete(key);
		},
		async dispose() {
			bound = undefined;
			await link.release();
		},
	};
}
