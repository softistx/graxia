import { describe, expect, test } from 'bun:test';
import { GraxiaConfigError } from '@softistx/graxia';
import type { RedisClient } from 'bun';
import { describeRedis, redisUrl, uniquePrefix } from './env.test-util';
import { redisFieldLimit } from './field-limit';

describe('redisFieldLimit (config)', () => {
	test('limit, windowMs and burst must be integers of 1 or more', () => {
		const client = {} as RedisClient;
		for (const bad of [
			{ limit: 0, windowMs: 1000 },
			{ limit: 1, windowMs: 1.5 },
			{ limit: 2, windowMs: 1000, burst: 0 },
		])
			expect(() => redisFieldLimit({ client, ...bad })).toThrow(
				GraxiaConfigError,
			);
	});

	test('a prefix with no character before its colon is a config error', () => {
		const client = {} as RedisClient;
		for (const bad of ['', ':'])
			expect(() =>
				redisFieldLimit({ client, limit: 1, windowMs: 1000, prefix: bad }),
			).toThrow(
				'@softistx/graxia-redis: redisFieldLimit prefix must hold at least one character before its ":"',
			);
	});

	test('url and client together is a config error', () => {
		expect(() =>
			redisFieldLimit({
				limit: 1,
				windowMs: 1000,
				url: 'redis://x',
				client: {},
			} as never),
		).toThrow(
			'@softistx/graxia-redis: pass either "url" or "client", not both',
		);
	});
});

describeRedis('redisFieldLimit (Redis)', () => {
	test('refuses past the limit with a retryAfter, per key', async () => {
		const limit = redisFieldLimit({
			url: redisUrl,
			limit: 2,
			windowMs: 60_000,
			prefix: uniquePrefix('limit'),
		});
		expect(await limit.consume('a', 1)).toEqual({
			allowed: true,
			retryAfter: 0,
		});
		expect((await limit.consume('a', 1)).allowed).toBe(true);
		const refused = await limit.consume('a', 1);
		expect(refused.allowed).toBe(false);
		expect(refused.retryAfter).toBeGreaterThan(0);
		expect((await limit.consume('b', 1)).allowed).toBe(true);
		await limit.dispose();
	});

	test('a cost over the burst is refused for a window, spending nothing', async () => {
		const limit = redisFieldLimit({
			url: redisUrl,
			limit: 3,
			windowMs: 60_000,
			prefix: uniquePrefix('limit'),
		});
		expect(await limit.consume('a', 4)).toEqual({
			allowed: false,
			retryAfter: 60_000,
		});
		expect((await limit.consume('a', 3)).allowed).toBe(true);
		await limit.dispose();
	});

	test('a cost of several units is counted at once', async () => {
		const limit = redisFieldLimit({
			url: redisUrl,
			limit: 5,
			windowMs: 60_000,
			prefix: uniquePrefix('limit'),
		});
		expect((await limit.consume('a', 3)).allowed).toBe(true);
		expect((await limit.consume('a', 3)).allowed).toBe(false);
		expect((await limit.consume('a', 2)).allowed).toBe(true);
		await limit.dispose();
	});
});
