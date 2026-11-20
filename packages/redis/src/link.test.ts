import { describe, expect, test } from 'bun:test';
import { GraxiaConfigError } from '@softistx/graxia';
import { connectRedis, RedisError } from '@softistx/redis';
import type { RedisClient } from 'bun';
import { redisCache } from './cache';
import { describeRedis, redisUrl } from './env.test-util';
import { redisFieldLimit } from './field-limit';

// A url nothing listens on: any attempt to connect would hang or fail, so a
// prompt rejection proves nothing was opened.
const unreachable = 'redis://127.0.0.1:1';

describe('url adapters after dispose (no Redis needed)', () => {
	test('a field limit rejects after dispose and opens nothing', async () => {
		const limit = redisFieldLimit({
			url: unreachable,
			limit: 1,
			windowMs: 1000,
		});
		await limit.dispose();
		await expect(limit.consume('a', 1)).rejects.toThrow('used after dispose');
	});

	test('a cache rejects after dispose', async () => {
		const cache = redisCache({ url: unreachable });
		await cache.dispose?.();
		await expect(cache.get('k')).rejects.toThrow('used after dispose');
		await expect(cache.set('k', 'v')).rejects.toBeInstanceOf(GraxiaConfigError);
	});
});

describe('redisFieldLimit failures (no Redis needed)', () => {
	test('a connection that never comes up fails open within timeoutMs', async () => {
		const errors: unknown[] = [];
		const limit = redisFieldLimit({
			url: unreachable,
			limit: 1,
			windowMs: 1000,
			timeoutMs: 100,
			onError: (error) => errors.push(error),
		});
		const started = Date.now();
		expect(await limit.consume('a', 1)).toEqual({
			allowed: true,
			retryAfter: 0,
		});
		expect(Date.now() - started).toBeLessThan(2000);
		expect(errors.length).toBe(1);
		// a dispose never waits for a connect that is still pending
		const disposing = Date.now();
		await limit.dispose();
		expect(Date.now() - disposing).toBeLessThan(100);
	});

	const broken = new Proxy(
		{},
		{
			get() {
				throw new Error('down');
			},
		},
	) as unknown as RedisClient;

	test('a Redis error goes to onError and the call is let through', async () => {
		const errors: unknown[] = [];
		const limit = redisFieldLimit({
			client: broken,
			limit: 1,
			windowMs: 1000,
			onError: (error) => errors.push(error),
		});
		expect(await limit.consume('a', 1)).toEqual({
			allowed: true,
			retryAfter: 0,
		});
		expect(errors).toHaveLength(1);
	});

	test('a cost of 0 spends nothing and asks nothing of Redis', async () => {
		const errors: unknown[] = [];
		const limit = redisFieldLimit({
			client: broken,
			limit: 1,
			windowMs: 1000,
			onError: (error) => errors.push(error),
		});
		expect(await limit.consume('a', 0)).toEqual({
			allowed: true,
			retryAfter: 0,
		});
		expect(errors).toEqual([]);
	});

	test('burst × windowMs, the refill time and timeoutMs are bounded', () => {
		const client = {} as never;
		expect(() =>
			redisFieldLimit({ client, limit: 1, windowMs: 2 ** 52 }),
		).toThrow(GraxiaConfigError);
		expect(() =>
			redisFieldLimit({
				client,
				limit: 1,
				windowMs: 11 * 365 * 24 * 3600 * 1000,
			}),
		).toThrow('ten years');
		expect(() =>
			redisFieldLimit({ client, limit: 1, windowMs: 1000, timeoutMs: 0 }),
		).toThrow(GraxiaConfigError);
	});
});

describeRedis('a URI connected with other options (Redis)', () => {
	test('is a config error that points at { client }', async () => {
		const url = redisUrl as string;
		const taken = await connectRedis(url, { maxRetries: 5 });
		const cache = redisCache({ url });
		const failure = await cache.get('k').catch((error: unknown) => error);
		await taken.close();
		expect(failure).toBeInstanceOf(GraxiaConfigError);
		const message = (failure as Error).message;
		expect(message).toContain('pass that client as { client }');
		expect((failure as Error).cause).toBeInstanceOf(RedisError);
		expect(((failure as Error).cause as RedisError).code).toBe('URI_CONFLICT');
	});
});
