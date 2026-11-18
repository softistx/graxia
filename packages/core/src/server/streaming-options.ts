import { GraxiaConfigError } from '../errors/config-error';
import { resolveWebSocket } from '../ws/options';
import type { GraxiaOptions, ResolvedOptions } from './options';

/** @internal Resolves the options of the streamed transports (SSE, incremental delivery). */
export function resolveStreaming(
	options: GraxiaOptions<any>,
): Pick<ResolvedOptions, 'sse' | 'keepAliveMs' | 'incremental' | 'ws'> {
	const keepAliveMs = options.subscriptions?.keepAliveMs ?? 12_000;
	if (!Number.isFinite(keepAliveMs) || keepAliveMs <= 0)
		throw new GraxiaConfigError(
			'subscriptions.keepAliveMs must be a finite number above 0 (milliseconds)',
		);
	const given = options.incremental ?? true;
	const format =
		typeof given === 'object' ? (given.format ?? 'graphql17') : 'graphql17';
	if (format !== 'graphql17' && format !== 'legacy')
		throw new GraxiaConfigError(
			'incremental.format must be "graphql17" or "legacy"',
		);
	return {
		sse: options.subscriptions?.sse ?? true,
		ws: resolveWebSocket(options.subscriptions?.ws),
		keepAliveMs,
		incremental: given === false ? false : format,
	};
}
