import { afterAll, beforeAll, expect, test } from 'bun:test';
import { RedisClient } from 'bun';
import { redisCache } from './cache';
import { describeRedis, redisUrl, uniquePrefix } from './env.test-util';

describeRedis('redisCache (Redis)', () => {
	const prefix = uniquePrefix('cache');
	let client: RedisClient;
	beforeAll(() => {
		client = new RedisClient(redisUrl);
	});
	afterAll(() => client.close());

	test('get, set, delete and the key prefix', async () => {
		const cache = redisCache({ client, prefix });
		expect(await cache.get('a')).toBeUndefined();
		await cache.set('a', '1');
		expect(await cache.get('a')).toBe('1');
		expect(await client.get(`${prefix}a`)).toBe('1');
		expect(await cache.delete('a')).toBe(true);
		expect(await cache.delete('a')).toBe(false);
	});

	test('a prefix with or without its colon stores the same key', async () => {
		const bare = prefix.replace(/:$/, '');
		const cache = redisCache({ client, prefix: bare });
		await cache.set('c', '1');
		expect(await client.get(`${bare}:c`)).toBe('1');
		expect(await redisCache({ client, prefix }).get('c')).toBe('1');
		await cache.delete('c');
	});

	test('ttlMs becomes a PX expiry and the entry vanishes', async () => {
		const cache = redisCache({ client, prefix });
		await cache.set('t', 'v', { ttlMs: 100 });
		expect(await client.pttl(`${prefix}t`)).toBeGreaterThan(0);
		expect(await cache.get('t')).toBe('v');
		await Bun.sleep(150);
		expect(await cache.get('t')).toBeUndefined();
	});

	test('set without a ttl clears a previous one', async () => {
		const cache = redisCache({ client, prefix });
		await cache.set('k', '1', { ttlMs: 50 });
		await cache.set('k', '2');
		await Bun.sleep(100);
		expect(await cache.get('k')).toBe('2');
		await cache.delete('k');
	});

	test('dispose keeps a given client open and closes one it created', async () => {
		const given = redisCache({ client, prefix });
		await given.dispose?.();
		expect(await client.ping()).toBe('PONG');
		const own = redisCache({ url: redisUrl, prefix });
		await own.set('o', '1');
		await own.dispose?.();
		await expect(own.delete('o')).rejects.toThrow('used after dispose');
	});

	test('a second url holder still works after the first one is disposed', async () => {
		const first = redisCache({ url: redisUrl, prefix });
		const second = redisCache({ url: redisUrl, prefix });
		await second.set('s', '1');
		await first.dispose?.();
		expect(await second.get('s')).toBe('1');
		await second.delete('s');
		await second.dispose?.();
	});

	test('a prefix with no character before its colon is a config error', () => {
		for (const bad of ['', ':'])
			expect(() => redisCache({ client, prefix: bad })).toThrow(
				'redisCache prefix must hold at least one character before its ":"',
			);
	});
});
