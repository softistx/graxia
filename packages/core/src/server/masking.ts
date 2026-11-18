import type { ExecutionResult } from 'graphql';
import { defaultMask, type MaskError, maskResult } from '../errors/mask';
import { requestIdKey } from '../http/request-id';
import type { RequestState } from '../plugins/state';
import type { UnexpectedHandler } from './unexpected';

/** Masks the unexpected errors of one execution result. */
export type ResultMasker = (
	result: ExecutionResult,
	state: RequestState,
) => ExecutionResult;

/**
 * Builds the masker the transport applies to every execution result, after
 * the plugins and before encoding. The original of each masked error goes to
 * `onUnexpected` (phase `execution`). `false` disables masking (tests only).
 */
export function createResultMasker(
	maskError: MaskError | undefined,
	enabled: boolean,
	unexpected: UnexpectedHandler,
): ResultMasker {
	if (!enabled) return (result) => result;
	const mask = maskError ?? defaultMask;
	return (result, state) => {
		const masked = maskResult(result, mask, {
			correlationId: state.get(requestIdKey),
		});
		for (const error of masked.unexpected)
			unexpected.report(error, state, 'execution');
		return masked.result;
	};
}
