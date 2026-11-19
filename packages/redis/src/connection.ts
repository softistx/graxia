import { GraxiaConfigError } from '@graxia/core';
import { connectRedis, type RedisConnection as Holder } from '@softistx/redis';
import type { RedisClient } from 'bun';

/**
 * How an adapter reaches Redis: a `url` (defaults to `REDIS_URL`, then
 * `redis://localhost:6379`; the client is shared per URI with every other
 * holder of that URI through `@softistx/redis`, and the adapter lets go of it
 * on `dispose()`) or a `client` you own and close yourself.
 */
export type RedisConnection =
	| { url?: string | undefined; client?: undefined }
	| { client: RedisClient; url?: undefined };

/** A lazily opened client and the way to let it go. */
export interface RedisLink {
	/** The client; a `url` connects on the first call, and a failed connect is retried by the next one. */
	client(): Promise<RedisClient>;
	/** Lets go of a shared client the adapter took; a client you passed stays open. */
	release(): Promise<void>;
}

/**
 * Resolves the connection options to a {@link RedisLink}.
 *
 * @throws {GraxiaConfigError} when both `url` and `client` are given.
 */
export function resolveLink(options: RedisConnection): RedisLink {
	if (options.client !== undefined && options.url !== undefined)
		throw new GraxiaConfigError(
			'@graxia/redis: pass either "url" or "client", not both',
		);
	const given = options.client;
	if (given !== undefined)
		return { client: async () => given, release: async () => {} };
	const uri = options.url ?? process.env['REDIS_URL'] ?? DEFAULT_URL;
	let holder: Promise<Holder> | undefined;
	return {
		async client() {
			holder ??= connectRedis(uri);
			try {
				return (await holder).client;
			} catch (error) {
				holder = undefined;
				throw error;
			}
		},
		async release() {
			const open = holder;
			holder = undefined;
			await (await open?.catch(() => undefined))?.close();
		},
	};
}

const DEFAULT_URL = 'redis://localhost:6379';
