import { type FieldLimit, GraxiaConfigError } from '@graxia/core';
import { consumeRateLimit } from '@softistx/redis';
import type { RedisClient } from 'bun';
import { type RedisConnection, resolveLink } from './connection';

/** Options of {@link redisFieldLimit}. */
export type RedisFieldLimitOptions = RedisConnection & {
	/** Units allowed per key over `windowMs`, an integer of 1 or more. */
	limit: number;
	/** The window in milliseconds, an integer of 1 or more. */
	windowMs: number;
	/** Units a full bucket lets through at once. Default `limit`. */
	burst?: number;
	/** Prepended to every key with exactly one trailing `:`. Default `graxia:limit:`. */
	prefix?: string;
	/** How long one check waits for Redis, in milliseconds. Default 1000. */
	timeoutMs?: number;
	/**
	 * Receives a Redis failure (down, timeout, refused policy). The call is then
	 * let through (fail open): a limit never takes the API down with Redis.
	 * Nothing is logged without it. A misuse (`GraxiaConfigError`) still rejects.
	 */
	onError?: (error: unknown) => void;
};

/** A {@link FieldLimit} on Redis, and the way to let go of its connection. */
export interface RedisFieldLimit extends FieldLimit {
	/** Lets go of the shared client when the limit opened it (`url`). */
	dispose(): Promise<void>;
}

/** `burst × windowMs` the Redis script counts exactly, and the longest refill of an empty bucket (ten years). */
const MAX_BURST_WINDOW = Math.floor(Number.MAX_SAFE_INTEGER / 1000);
const MAX_REFILL_MS = 10 * 365 * 24 * 60 * 60 * 1000;

const positive = (value: unknown): value is number =>
	typeof value === 'number' && Number.isInteger(value) && value >= 1;

/** The link's client, or a rejection once `timeoutMs` passes (a connect that hangs fails open like a slow command). */
function clientWithin(
	link: { client(): Promise<RedisClient> },
	timeoutMs: number,
): Promise<RedisClient> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(
			() =>
				reject(
					new Error(`redisFieldLimit: no Redis client within ${timeoutMs} ms`),
				),
			timeoutMs,
		);
	});
	return Promise.race([link.client(), timeout]).finally(() =>
		clearTimeout(timer),
	);
}

/**
 * A {@link FieldLimit} for `fieldRateLimit` shared by every process on one
 * Redis, on `@softistx/redis`'s rate limit (a GCRA bucket timed by the server,
 * so the processes need no common clock). A cost over the burst can never pass
 * and is refused at once with `retryAfter` of one window; a cost of 0 spends nothing.
 * A Redis failure goes to `onError` and lets the call through (fail open).
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
	if (burst * windowMs > MAX_BURST_WINDOW)
		throw new GraxiaConfigError(
			`redisFieldLimit: burst × windowMs must be at most ${MAX_BURST_WINDOW}`,
		);
	if ((burst * windowMs) / limit > MAX_REFILL_MS)
		throw new GraxiaConfigError(
			'redisFieldLimit: an empty bucket would take over ten years to refill (burst × windowMs ÷ limit); check that windowMs is in milliseconds',
		);
	const timeoutMs = options.timeoutMs ?? 1000;
	if (!positive(timeoutMs))
		throw new GraxiaConfigError(
			'redisFieldLimit: timeoutMs must be an integer of 1 or more',
		);
	const link = resolveLink(options);
	const name = (options.prefix ?? 'graxia:limit:').replace(/:$/, '');
	if (name.length === 0)
		throw new GraxiaConfigError(
			'@graxia/redis: redisFieldLimit prefix must hold at least one character before its ":"',
		);
	const prefix = `${name}:`;
	return {
		async consume(key, cost) {
			if (!Number.isFinite(cost) || cost > burst)
				return { allowed: false, retryAfter: windowMs };
			if (cost <= 0) return { allowed: true, retryAfter: 0 };
			try {
				const result = await consumeRateLimit(
					await clientWithin(link, timeoutMs),
					{
						key: prefix + key,
						name: 'graxia field limit',
						limit,
						per: windowMs,
						burst,
						cost: Math.ceil(cost),
						timeoutMs,
					},
				);
				return { allowed: result.allowed, retryAfter: result.retryAfter };
			} catch (error) {
				// a misuse (used after dispose, a URI connected with other options) is a bug, never failed open
				if (error instanceof GraxiaConfigError) throw error;
				try {
					options.onError?.(error);
				} catch {
					// a faulty observer never breaks the request
				}
				return { allowed: true, retryAfter: 0 };
			}
		},
		dispose: () => link.release(),
	};
}
