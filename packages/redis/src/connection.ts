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
	let connected: Holder | undefined;
	let released = false;
	return {
		async client() {
			if (released)
				throw new GraxiaConfigError('@graxia/redis: used after dispose()');
			holder ??= connectRedis(uri);
			const pending = holder;
			try {
				const open = await pending;
				connected = open;
				return open.client;
			} catch (error) {
				if (holder === pending) holder = undefined;
				throw shared(error, uri);
			}
		},
		async release() {
			released = true;
			const open = holder;
			holder = undefined;
			if (open === undefined) return;
			// A connect still pending (Redis down) never holds up a shutdown: the late holder is closed when it settles.
			if (connected === undefined) {
				void open.then(
					(late) => late.close(),
					() => undefined,
				);
				return;
			}
			const done = connected;
			connected = undefined;
			await done.close();
		},
	};
}

// Temporary, until softistx/nxgt-data#436 (tracked in #81): switch to the typed RedisError code
/** `connectRedis` refuses a URI another module connected with other options. */
function shared(error: unknown, uri: string): unknown {
	if (
		error instanceof TypeError &&
		error.message.startsWith('connectRedis: this URI is already connected')
	)
		return new GraxiaConfigError(
			`@graxia/redis: ${redactUri(uri)} is already connected by another module with other options; pass that client as { client }`,
			{ cause: error },
		);
	return error;
}

/** The URI without its credentials, which may be a password. */
function redactUri(uri: string): string {
	try {
		const url = new URL(uri);
		url.username = '';
		url.password = '';
		return url.toString();
	} catch {
		return '<redis uri>';
	}
}

const DEFAULT_URL = 'redis://localhost:6379';
