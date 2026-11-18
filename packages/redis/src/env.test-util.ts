import { describe } from 'bun:test';
import type { RedisClient } from 'bun';

/** The Redis the integration specs run against; they are skipped when unset. */
export const redisUrl = process.env['REDIS_URL'];

/** `describe` when `REDIS_URL` is set, `describe.skip` otherwise. */
export const describeRedis = redisUrl ? describe : describe.skip;

/** A prefix no other spec shares, so specs never see each other's events. */
export const uniquePrefix = (name: string): string =>
	`graxia-test:${name}:${crypto.randomUUID()}:`;

/** Polls until `check` returns true (default up to 5 s). */
export async function until(
	check: () => boolean | Promise<boolean>,
	ms = 5000,
): Promise<void> {
	const end = Date.now() + ms;
	while (!(await check())) {
		if (Date.now() > end) throw new Error('until: timed out');
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
}

/** Number of Redis subscribers of a channel (`PUBSUB NUMSUB`). */
export async function numsub(
	admin: RedisClient,
	channel: string,
): Promise<number> {
	const reply = (await admin.send('PUBSUB', ['NUMSUB', channel])) as [
		string,
		number,
	];
	return reply[1];
}

/** The next value of an iterator, or `'timeout'` after `ms`. */
export async function nextOrTimeout<T>(
	iterator: AsyncIterator<T>,
	ms = 300,
): Promise<T | 'timeout' | 'done'> {
	const result = await Promise.race([
		iterator.next(),
		new Promise<'timeout'>((resolve) => setTimeout(resolve, ms, 'timeout')),
	]);
	if (result === 'timeout') return result;
	return result.done ? 'done' : result.value;
}
