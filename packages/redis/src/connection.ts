import { GraxiaConfigError } from '@graxia/core';
import { RedisClient } from 'bun';

/**
 * How an adapter reaches Redis: a `url` (the adapter creates, connects and
 * later closes its own client; defaults to `REDIS_URL`, then
 * `redis://localhost:6379`) or a `client` you own and close yourself.
 */
export type RedisConnection =
	| { url?: string | undefined; client?: undefined }
	| { client: RedisClient; url?: undefined };

/** A client and whether the adapter created it (and must close it). */
export interface ResolvedClient {
	client: RedisClient;
	owned: boolean;
}

/**
 * Resolves the connection options to a client.
 *
 * @throws {GraxiaConfigError} when both `url` and `client` are given.
 */
export function resolveClient(options: RedisConnection): ResolvedClient {
	if (options.client !== undefined && options.url !== undefined)
		throw new GraxiaConfigError(
			'@graxia/redis: pass either "url" or "client", not both',
		);
	if (options.client !== undefined)
		return { client: options.client, owned: false };
	return { client: new RedisClient(options.url), owned: true };
}

/** Closes a client, ignoring a client that is already closed. */
export function closeQuietly(client: RedisClient): void {
	try {
		client.close();
	} catch {
		// already closed
	}
}
