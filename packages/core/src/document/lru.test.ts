import { describe, expect, test } from 'bun:test';
import { createDocumentCache } from './caches';
import { createLruCache } from './lru';

const mk = (
	o: { max?: number; maxWeight?: number; ttlMs?: number },
	t = { v: 0 },
) =>
	createLruCache<string, string>({
		max: o.max ?? 10,
		maxWeight: o.maxWeight ?? 1000,
		ttlMs: o.ttlMs ?? 100,
		weigh: (_k, v) => v.length,
		now: () => t.v,
	});

describe('LruCache', () => {
	test('evicts the least recently used by count', () => {
		const c = mk({ max: 2 });
		c.set('a', '1');
		c.set('b', '2');
		c.get('a');
		c.set('c', '3');
		expect(c.get('b')).toBeUndefined();
		expect(c.get('a')).toBe('1');
		expect(c.size).toBe(2);
	});

	test('evicts by total weight, and skips an entry over maxWeight / 8', () => {
		const c = mk({ maxWeight: 80 });
		c.set('a', 'x'.repeat(10));
		c.set('b', 'x'.repeat(10));
		c.set('huge', 'x'.repeat(11));
		expect(c.get('huge')).toBeUndefined();
		expect(c.weight).toBe(20);
		for (const k of 'cdefghijk') c.set(k, 'x'.repeat(10));
		expect(c.weight).toBeLessThanOrEqual(80);
		expect(c.get('a')).toBeUndefined();
	});

	test('expires lazily after ttl', () => {
		const t = { v: 0 };
		const c = mk({ ttlMs: 100 }, t);
		c.set('a', '1');
		t.v = 99;
		expect(c.get('a')).toBe('1');
		t.v = 100;
		expect(c.get('a')).toBeUndefined();
		expect(c.size).toBe(0);
	});

	test('document cache evicts by weight (sources weigh length x 2)', () => {
		const c = createDocumentCache({ maxBytes: 160, max: 100 });
		for (let i = 0; i < 20; i++)
			c.set(`{ f${String(i).padStart(2, '0')} }`, { errors: [] });
		expect(c.weight).toBeLessThanOrEqual(160);
		expect(c.size).toBeLessThan(20);
	});
});
