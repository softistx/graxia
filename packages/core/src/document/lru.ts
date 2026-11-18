/** Options of {@link LruCache}. */
export interface LruCacheOptions<K, V> {
	/** The most entries kept. */
	readonly max: number;
	/** The most total weight kept (the sum of the entries' weights). */
	readonly maxWeight: number;
	/** How long an entry lives, in milliseconds; checked lazily on `get`. */
	readonly ttlMs: number;
	/** The weight of an entry. */
	readonly weigh: (key: K, value: V) => number;
	/** The clock in milliseconds; inject it in specs. `Date.now` by default. */
	readonly now?: () => number;
}

/** A weighted least-recently-used cache with a time to live. */
export interface LruCache<K, V> {
	/** The value, refreshing its recency; undefined when absent or expired. */
	get(key: K): V | undefined;
	/**
	 * Stores a value and evicts the least recently used entries until the
	 * count and the total weight fit. An entry heavier than `maxWeight / 8`
	 * is not stored, and evicts nothing.
	 */
	set(key: K, value: V): void;
	/** The number of entries held (expired ones included until read). */
	readonly size: number;
	/** The total weight held. */
	readonly weight: number;
	/** Removes every entry. */
	clear(): void;
}

interface Entry<V> {
	readonly value: V;
	readonly weight: number;
	readonly expires: number;
}

/** Creates a {@link LruCache}. */
export function createLruCache<K, V>(
	options: LruCacheOptions<K, V>,
): LruCache<K, V> {
	const { max, maxWeight, ttlMs, weigh, now = Date.now } = options;
	const entries = new Map<K, Entry<V>>();
	let total = 0;
	const drop = (key: K, entry: Entry<V>) => {
		entries.delete(key);
		total -= entry.weight;
	};
	return {
		get(key) {
			const entry = entries.get(key);
			if (entry === undefined) return undefined;
			if (entry.expires <= now()) {
				drop(key, entry);
				return undefined;
			}
			// A Map iterates in insertion order: re-insert to mark it recent.
			entries.delete(key);
			entries.set(key, entry);
			return entry.value;
		},
		set(key, value) {
			const previous = entries.get(key);
			if (previous !== undefined) drop(key, previous);
			const weight = weigh(key, value);
			if (weight > maxWeight / 8) return;
			entries.set(key, { value, weight, expires: now() + ttlMs });
			total += weight;
			for (const [oldest, entry] of entries) {
				if (entries.size <= max && total <= maxWeight) break;
				drop(oldest, entry);
			}
		},
		get size() {
			return entries.size;
		},
		get weight() {
			return total;
		},
		clear() {
			entries.clear();
			total = 0;
		},
	};
}
