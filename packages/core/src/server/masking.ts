import type { ExecutionResult, GraphQLSchema } from 'graphql';
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
	schema: GraphQLSchema,
	unexpected: UnexpectedHandler,
): ResultMasker {
	if (!enabled) return (result) => result;
	const mask = maskError ?? defaultMask;
	return (result, state) => {
		const masked = maskResult(
			result,
			mask,
			{
				correlationId: state.get(requestIdKey),
			},
			schema,
		);
		for (const error of masked.unexpected)
			unexpected.report(error, state, 'execution');
		return masked.result;
	};
}

/**
 * Masks one payload of a stream: the result itself, and the `errors` of each
 * entry of `incremental` and `completed` (the graphql 17 shapes, and the
 * legacy `incremental` entries). A payload without errors is returned as is.
 */
export function maskPayload(
	mask: ResultMasker,
	payload: ExecutionResult,
	state: RequestState,
): ExecutionResult {
	const top = mask(payload, state);
	const out: Record<string, unknown> = { ...top };
	let changed = top !== payload;
	for (const key of ['incremental', 'completed'] as const) {
		const entries = (payload as Record<string, unknown>)[key];
		if (!Array.isArray(entries)) continue;
		const masked = entries.map((entry) => mask(entry, state));
		if (masked.some((entry, i) => entry !== entries[i])) {
			out[key] = masked;
			changed = true;
		}
	}
	return changed ? (out as ExecutionResult) : payload;
}
