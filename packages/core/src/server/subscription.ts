import { type ExecutionArgs, subscribe } from 'graphql';
import type { RequestState } from '../plugins/state';
import { failure, type Outcome } from './outcome';
import type { Runtime } from './runtime';
import { isSingleResult, release, runExecutionStage } from './stage';

/**
 * Starts a subscription: `onSubscribe` hooks around graphql's `subscribe`.
 * Gives a `stream` outcome for a source of events, a `result` for a single
 * answer (an error before the first event, or a hook's `setResult`).
 */
export async function subscription(
	rt: Runtime,
	call: { request: Request; state: RequestState },
	args: ExecutionArgs,
	{ stop, scope }: { stop: AbortController; scope: <T>(work: () => T) => T },
): Promise<Outcome> {
	const run = await runExecutionStage(rt, call, args, 'onSubscribe', subscribe);
	if ('outcome' in run) return run.outcome;
	const { result } = run;
	if (isSingleResult(result)) return { kind: 'result', result, scope };
	if (
		typeof result === 'object' &&
		result !== null &&
		Symbol.asyncIterator in result &&
		!('initialResult' in result)
	)
		return {
			kind: 'stream',
			subscription: true,
			source: (result as AsyncIterable<unknown>)[Symbol.asyncIterator](),
			stop,
			scope,
		};
	await release(result);
	return failure(
		'Incremental delivery (@defer, @stream) is not supported over this transport yet.',
		{ code: 'INCREMENTAL_NOT_SUPPORTED' },
	);
}
