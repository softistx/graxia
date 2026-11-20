import { GraxiaConfigError } from '../errors/config-error';
import {
	type BatchingOption,
	DEFAULT_BATCH_LIMIT,
	type ResolvedBatching,
} from '../http/batch';
import { DEFAULT_BODY_BYTES } from '../http/body';
import { assertCostDirectives } from '../limits/clash';
import { resolveOperationLimits } from '../limits/options';
import { resolveSecurity } from '../security/options';
import { resolveUploads } from '../uploads/options';
import type { GraxiaOptions, ResolvedOptions } from './options';
import { resolveStreaming } from './streaming-options';

const BATCHING_FORMS =
	'batching must be true, false or { limit: <positive integer> }';

function resolveBatching(option: BatchingOption | undefined): ResolvedBatching {
	if (option === undefined || option === false) return false;
	if (option === true) return { limit: DEFAULT_BATCH_LIMIT };
	if (
		typeof option !== 'object' ||
		option === null ||
		!Number.isInteger(option.limit) ||
		option.limit < 1
	)
		throw new GraxiaConfigError(BATCHING_FORMS);
	return option;
}

/** @internal The options with defaults applied; throws a `GraxiaConfigError` on a bad value. */
export function resolve(options: GraxiaOptions<any>): ResolvedOptions {
	const bodyBytes = options.limits?.bodyBytes ?? DEFAULT_BODY_BYTES;
	if (!Number.isInteger(bodyBytes) || bodyBytes < 1)
		throw new GraxiaConfigError('limits.bodyBytes must be a positive integer');
	const operationLimits = resolveOperationLimits(options.limits);
	if (operationLimits.cost) assertCostDirectives(options.schema);
	const batching = resolveBatching(options.batching);
	const path = options.path ?? '/graphql';
	if (path !== false && !path.startsWith('/'))
		throw new GraxiaConfigError('path must start with "/" (or be false)');
	const asyncContext = options.asyncContext ?? true;
	const shutdownTimeout = options.shutdownTimeout ?? 10_000;
	if (!Number.isInteger(shutdownTimeout) || shutdownTimeout < 0)
		throw new GraxiaConfigError(
			'shutdownTimeout must be a non-negative integer (milliseconds)',
		);
	const errorHttp = options.errorHttp ?? true;
	if (typeof errorHttp !== 'boolean')
		throw new GraxiaConfigError('errorHttp must be true or false');
	const security = resolveSecurity(options);
	return {
		path,
		bodyBytes,
		operationLimits,
		batching,
		asyncContext,
		shutdownTimeout,
		errorHttp,
		...security,
		...resolveUploads(options.uploads, security.csrf),
		...resolveStreaming(options),
	};
}
