import { type FieldLimit, GraxiaConfigError } from '@graxia/core';
import { consumeRateLimit } from '@softistx/redis';
import { type RedisConnection, resolveLink } from './connection';

/** Options of {@link redisFieldLimit}. */
export type RedisFieldLimitOptions = RedisConnection & {
	/** Units allowed per key over `windowMs`, an integer of 1 or more. */
	limit: number;
	/** The window in milliseconds, an integer of 1 or more. */
	windowMs: number;
	/** Units a full bucket lets through at once. Default `limit`. */
	burst?: number;
	/** Prepended to every key; `:` is added when missing. Default `graxia:limit:`. */
	prefix?: string;
};

/** A {@link FieldLimit} on Redis, and the way to let go of its connection. */
export interface RedisFieldLimit extends FieldLimit {
	/** Lets go of the shared client when the limit opened it (`url`). */
	dispose(): Promise<void>;
}

const positive = (value: unknown): value is number =>
	typeof value === 'number' && Number.isInteger(value) && value >= 1;

/**
 * A {@link FieldLimit} for `fieldRateLimit` shared by every process on one
 * Redis, on `@softistx/redis`'s rate limit (a GCRA bucket timed by the server,
 * so the processes need no common clock). A cost over the burst can never pass
 * and is refused at once with `retryAfter` of one window.
 *
 * @example
 * fieldRateLimit({
 *   fields: { search: redisFieldLimit({ url, limit: 30, windowMs: 60_000 }) },
 * });
 * @throws {GraxiaConfigError} when `limit`, `windowMs` or `burst` is not an integer of 1 or more.
 */
export function redisFieldLimit(
	options: RedisFieldLimitOptions,
): RedisFieldLimit {
	const { limit, windowMs } = options;
	const burst = options.burst ?? limit;
	for (const [name, value] of [
		['limit', limit],
		['windowMs', windowMs],
		['burst', burst],
	] as const)
		if (!positive(value))
			throw new GraxiaConfigError(
				`redisFieldLimit: ${name} must be an integer of 1 or more`,
			);
	const link = resolveLink(options);
	const prefix = (options.prefix ?? 'graxia:limit:').replace(/:?$/, ':');
	return {
		async consume(key, cost) {
			if (!Number.isFinite(cost) || cost > burst)
				return { allowed: false, retryAfter: windowMs };
			const result = await consumeRateLimit(await link.client(), {
				key: prefix + key,
				name: 'graxia field limit',
				limit,
				per: windowMs,
				burst,
				cost: Math.max(1, Math.ceil(cost)),
			});
			return { allowed: result.allowed, retryAfter: result.retryAfter };
		},
		dispose: () => link.release(),
	};
}
