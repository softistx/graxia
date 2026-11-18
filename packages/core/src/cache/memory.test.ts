import { describe, expect, test } from 'bun:test';
import { createMemoryCache } from './memory';

describe('createMemoryCache', () => {
	test('get, set and delete', async () => {
		const cache = createMemoryCache();
		expect(await cache.get('a')).toBeUndefined();
		await cache.set('a', '1');
		expect(await cache.get('a')).toBe('1');
		expect(await cache.delete('a')).toBe(true);
		expect(await cache.delete('a')).toBe(false);
		expect(await cache.get('a')).toBeUndefined();
	});

	test('an entry expires after its ttl, lazily', async () => {
		let time = 1000;
		const cache = createMemoryCache({ now: () => time });
		await cache.set('a', '1', { ttlMs: 100 });
		await cache.set('b', '2');
		time += 99;
		expect(await cache.get('a')).toBe('1');
		time += 1;
		expect(await cache.get('a')).toBeUndefined();
		expect(await cache.get('b')).toBe('2');
	});

	test('delete of an expired entry reports false', async () => {
		let time = 0;
		const cache = createMemoryCache({ now: () => time });
		await cache.set('a', '1', { ttlMs: 10 });
		time = 10;
		expect(await cache.delete('a')).toBe(false);
	});

	test('set replaces the value and its ttl', async () => {
		let time = 0;
		const cache = createMemoryCache({ now: () => time });
		await cache.set('a', '1', { ttlMs: 10 });
		await cache.set('a', '2');
		time = 1000;
		expect(await cache.get('a')).toBe('2');
	});

	test('the least recently used entry is evicted past maxEntries', async () => {
		const cache = createMemoryCache({ maxEntries: 2 });
		await cache.set('a', '1');
		await cache.set('b', '2');
		await cache.get('a');
		await cache.set('c', '3');
		expect(await cache.get('b')).toBeUndefined();
		expect(await cache.get('a')).toBe('1');
		expect(await cache.get('c')).toBe('3');
	});

	test('an invalid maxEntries falls back to 1000', async () => {
		const cache = createMemoryCache({ maxEntries: 0 });
		for (let i = 0; i < 500; i++) await cache.set(`k${i}`, 'v');
		expect(await cache.get('k0')).toBe('v');
	});

	test('non-string values are supported through the type parameter', async () => {
		const cache = createMemoryCache<{ n: number }>();
		await cache.set('a', { n: 1 });
		expect(await cache.get('a')).toEqual({ n: 1 });
	});
});
