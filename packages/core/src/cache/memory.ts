import { createLruCache } from '../document/lru';
import type { KeyValueCache } from './types';

/** Options of {@link createMemoryCache}. */
export interface MemoryCacheOptions {
	/** The most entries kept before the least recently used is evicted. Default 1000. */
	maxEntries?: number;
	/** The clock in milliseconds; inject it in specs. `Date.now` by default. */
	now?: () => number;
}

interface Slot<V> {
	readonly value: V;
	/** Epoch milliseconds, or `Infinity`. */
	readonly expiresAt: number;
}

/**
 * Creates an in-process {@link KeyValueCache}: least-recently-used eviction
 * past `maxEntries`, a per-entry time to live checked lazily on read.
 *
 * @example
 * const cache = createMemoryCache({ maxEntries: 500 });
 * await cache.set('k', 'v', { ttlMs: 1000 });
 */
export function createMemoryCache<V = string>(
	options: MemoryCacheOptions = {},
): KeyValueCache<V> {
	const { now = Date.now } = options;
	const requested = options.maxEntries;
	const max =
		requested !== undefined && Number.isFinite(requested) && requested >= 1
			? Math.floor(requested)
			: 1000;
	// Weight 1 per entry; a TTL of Infinity leaves expiry to the slot itself.
	const lru = createLruCache<string, Slot<V>>({
		max,
		maxWeight: max * 8,
		ttlMs: Number.POSITIVE_INFINITY,
		weigh: () => 1,
		now,
	});
	const live = (key: string): Slot<V> | undefined => {
		const slot = lru.get(key);
		if (slot === undefined) return undefined;
		if (slot.expiresAt <= now()) {
			lru.delete(key);
			return undefined;
		}
		return slot;
	};
	return {
		async get(key) {
			return live(key)?.value;
		},
		async set(key, value, setOptions = {}) {
			const ttl = setOptions.ttlMs;
			const expiresAt =
				ttl !== undefined && Number.isFinite(ttl) && ttl > 0
					? now() + ttl
					: Number.POSITIVE_INFINITY;
			lru.set(key, { value, expiresAt });
		},
		async delete(key) {
			const wasLive = live(key) !== undefined;
			lru.delete(key);
			return wasLive;
		},
	};
}
