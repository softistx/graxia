import { afterAll, beforeAll, expect, test } from 'bun:test';
import { filter, pipe } from '@graxia/core';
import { RedisClient } from 'bun';
import {
	describeRedis,
	nextOrTimeout,
	numsub,
	redisUrl,
	uniquePrefix,
	until,
} from './env.test-util';
import { type RedisPubSub, redisPubSub } from './pubsub';

type Topics = {
	post: [id: string, payload: { id: string; ok: boolean }];
	tick: [payload: number];
};

describeRedis('redisPubSub (Redis)', () => {
	const prefix = uniquePrefix('pubsub');
	const open: RedisPubSub<Topics>[] = [];
	const errors: unknown[] = [];
	let admin: RedisClient;
	const make = (extra: Record<string, unknown> = {}) => {
		const pubsub = redisPubSub<Topics>({
			url: redisUrl,
			prefix,
			onError: (error) => errors.push(error),
			...extra,
		});
		open.push(pubsub);
		return pubsub;
	};
	beforeAll(() => {
		admin = new RedisClient(redisUrl);
	});
	afterAll(async () => {
		await Promise.all(open.map((pubsub) => pubsub.dispose()));
		admin.close();
	});

	test('fans out across two instances, typed topics, id-scoped channels', async () => {
		const a = make();
		const b = make();
		const events = b.subscribe('post', '1');
		await b.ready();
		await a.publish('post', '1', { id: '1', ok: true });
		expect((await events.next()).value).toEqual({ id: '1', ok: true });
		await events.return?.();
	});

	test('pipe and filter work on a Redis subscription', async () => {
		const a = make();
		const b = make();
		const events = pipe(
			b.subscribe('post', '2'),
			filter((p) => p.ok),
		);
		await b.ready();
		await a.publish('post', '2', { id: 'x', ok: false });
		await a.publish('post', '2', { id: 'y', ok: true });
		expect((await events.next()).value?.id).toBe('y');
		await events.return?.();
	});

	test('the same instance receives its own event right after subscribe()', async () => {
		const a = make();
		const events = a.subscribe('tick');
		await a.publish('tick', 5);
		expect((await events.next()).value).toBe(5);
		await events.return?.();
	});

	test('the last local subscriber leaving sends UNSUBSCRIBE', async () => {
		const a = make();
		const first = a.subscribe('tick');
		const second = a.subscribe('tick');
		await a.ready();
		expect(await numsub(admin, `${prefix}tick`)).toBe(1);
		await first.return?.();
		await a.ready();
		expect(await numsub(admin, `${prefix}tick`)).toBe(1);
		await second.return?.();
		await until(async () => (await numsub(admin, `${prefix}tick`)) === 0);
	});

	test('a malformed payload is skipped and reported', async () => {
		const a = make();
		const events = a.subscribe('tick');
		await a.ready();
		const before = errors.length;
		await admin.publish(`${prefix}tick`, '{nope');
		await a.publish('tick', 9);
		expect((await events.next()).value).toBe(9);
		expect(errors.length).toBe(before + 1);
		await events.return?.();
	});

	test('survives a killed subscriber connection: later events still arrive', async () => {
		const a = make();
		const b = make();
		const events = b.subscribe('tick');
		await b.ready();
		await admin.send('CLIENT', ['KILL', 'TYPE', 'pubsub']);
		await until(async () => (await numsub(admin, `${prefix}tick`)) === 1);
		await b.ready();
		await a.publish('tick', 11);
		expect(await nextOrTimeout(events, 2000)).toBe(11);
		// no doubled delivery after the resubscribe
		expect(await nextOrTimeout(events)).toBe('timeout');
		await events.return?.();
	});

	test('dispose ends every iterator and publish becomes a no-op', async () => {
		const own = uniquePrefix('dispose');
		const a = make({ prefix: own });
		const events = a.subscribe('tick');
		await a.ready();
		expect(await numsub(admin, `${own}tick`)).toBe(1);
		await a.dispose();
		expect((await events.next()).done).toBe(true);
		await a.publish('tick', 1);
		await until(async () => (await numsub(admin, `${own}tick`)) === 0);
	});

	test('overflow drops the oldest event', async () => {
		const dropped: unknown[] = [];
		const a = make({
			bufferSize: 2,
			onOverflow: (i: { dropped: unknown }) => dropped.push(i.dropped),
		});
		const events = a.subscribe('tick');
		for (const n of [1, 2, 3]) await a.publish('tick', n);
		await until(() => dropped.length === 1);
		expect(dropped).toEqual([1]);
		await events.return?.();
	});
});
