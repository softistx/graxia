import { GraxiaConfigError } from '../errors/config-error';
import { DEFAULT_BODY_BYTES } from '../http/body';
import { assertCostDirectives } from '../limits/clash';
import { resolveOperationLimits } from '../limits/options';
import { resolveSecurity } from '../security/options';
import { resolveUploads } from '../uploads/options';
import type { GraxiaOptions, ResolvedOptions } from './options';
import { resolveStreaming } from './streaming-options';

/** @internal The options with defaults applied; throws a `GraxiaConfigError` on a bad value. */
export function resolve(options: GraxiaOptions<any>): ResolvedOptions {
	const bodyBytes = options.limits?.bodyBytes ?? DEFAULT_BODY_BYTES;
	if (!Number.isInteger(bodyBytes) || bodyBytes < 1)
		throw new GraxiaConfigError('limits.bodyBytes must be a positive integer');
	const operationLimits = resolveOperationLimits(options.limits);
	if (operationLimits.cost) assertCostDirectives(options.schema);
	const batching = options.batching ?? false;
	if (
		batching !== false &&
		(!Number.isInteger(batching.limit) || batching.limit < 1)
	)
		throw new GraxiaConfigError('batching.limit must be a positive integer');
	const path = options.path ?? '/graphql';
	if (path !== false && !path.startsWith('/'))
		throw new GraxiaConfigError('path must start with "/" (or be false)');
	const asyncContext = options.asyncContext ?? true;
	const shutdownTimeout = options.shutdownTimeout ?? 10_000;
	if (!Number.isInteger(shutdownTimeout) || shutdownTimeout < 0)
		throw new GraxiaConfigError(
			'shutdownTimeout must be a non-negative integer (milliseconds)',
		);
	const security = resolveSecurity(options);
	return {
		path,
		bodyBytes,
		operationLimits,
		batching,
		asyncContext,
		shutdownTimeout,
		...security,
		...resolveUploads(options.uploads, security.csrf),
		...resolveStreaming(options),
	};
}
