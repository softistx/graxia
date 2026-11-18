import { createStateKey, type RequestState } from '../plugins/state';
import type { Outcome } from './outcome';

/** What a plugin that refuses an operation asks of the plain HTTP answer. */
export interface HttpRefusal {
	status: number;
	headers?: Record<string, string>;
}

/**
 * @internal A plugin that answers with `setResult` sets this to give the plain
 * JSON response a status and headers (a batch entry, SSE and WebSocket ignore it).
 */
export const httpRefusalKey = createStateKey<HttpRefusal>('httpRefusal');

/** @internal Carries the operation's refusal, if a plugin set one, on a result outcome. */
export function withHttpRefusal(
	state: RequestState,
	outcome: Outcome,
): Outcome {
	const refusal = state.get(httpRefusalKey);
	return refusal && outcome.kind === 'result'
		? { ...outcome, refusal }
		: outcome;
}
