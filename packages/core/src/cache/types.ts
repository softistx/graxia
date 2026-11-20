/** Options of {@link KeyValueCache.set}. */
export interface CacheSetOptions {
	/** Time to live in milliseconds; absent or not a positive finite number means the entry never expires. */
	ttlMs?: number;
}

/**
 * A minimal asynchronous key-value store, strings by default (callers
 * serialise). `createMemoryCache` implements it in process and
 * `redisCache` from `@softistx/graxia-redis` across processes. Upcoming graxia
 * features (persisted queries, response caching) take one; your own plugins can
 * use it today.
 *
 * @example
 * await cache.set('greeting', 'hello', { ttlMs: 60_000 });
 * await cache.get('greeting'); // 'hello'
 * await cache.delete('greeting'); // true
 */
export interface KeyValueCache<V = string> {
	/** The value, or `undefined` when absent or expired. */
	get(key: string): Promise<V | undefined>;
	/** Stores a value, replacing any previous one and its time to live. */
	set(key: string, value: V, options?: CacheSetOptions): Promise<void>;
	/** Removes a key; true when a live entry was removed. */
	delete(key: string): Promise<boolean>;
	/** Releases what the cache holds (connections); the memory cache has nothing to release. */
	dispose?(): Promise<void>;
}
