import { GraxiaConfigError } from '../errors/config-error';
import { resolveWebSocket } from '../ws/options';
import type { GraxiaOptions, ResolvedOptions } from './options';

/** @internal Resolves the options of the streamed transports (SSE, incremental delivery). */
export function resolveStreaming(
	options: GraxiaOptions<any>,
): Pick<ResolvedOptions, 'sse' | 'keepAliveMs' | 'incremental' | 'ws'> {
	const givenSse = options.subscriptions?.sse;
	const keepAliveMs =
		typeof givenSse === 'object' ? (givenSse.keepAliveMs ?? 12_000) : 12_000;
	if (!Number.isInteger(keepAliveMs) || keepAliveMs < 0)
		throw new GraxiaConfigError(
			'subscriptions.sse.keepAliveMs must be a non-negative integer (milliseconds, 0 turns keep-alive comments off)',
		);
	const given = options.incremental ?? true;
	const format =
		typeof given === 'object' ? (given.format ?? 'graphql17') : 'graphql17';
	if (format !== 'graphql17' && format !== 'legacy')
		throw new GraxiaConfigError(
			'incremental.format must be "graphql17" or "legacy"',
		);
	return {
		sse: givenSse !== false,
		ws: resolveWebSocket(options.subscriptions?.ws),
		keepAliveMs,
		incremental: given === false ? false : format,
	};
}
