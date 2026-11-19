import { type ExecutionArgs, type ExecutionResult, execute } from 'graphql';
import type { RequestState } from '../plugins/state';
import type { ExecuteFn, ExecutionOutput } from '../plugins/types';
import { failure, type Outcome, settle, unexpected } from './outcome';
import type { Runtime } from './runtime';

/** The operation's stage that runs the executor. */
export type ExecutionStage = 'onExecute' | 'onSubscribe';

/** What a stage run produced, before the caller decides what to do with it. */
export type StageRun =
	| { outcome: Outcome }
	| { result: ExecutionOutput | undefined };

/** Ends a stream a custom executor returned, so its source is released. */
export async function release(
	result: ExecutionOutput | undefined,
): Promise<void> {
	if (typeof result !== 'object' || result === null) return;
	const stream =
		Symbol.asyncIterator in result
			? (result as AsyncIterable<unknown>)[Symbol.asyncIterator]()
			: (result as { subsequentResults?: AsyncIterator<unknown> })
					.subsequentResults;
	try {
		await stream?.return?.();
	} catch {
		// Releasing is best effort.
	}
}

/** Whether `result` is one plain result (no `@defer`/`@stream`, no stream of results). */
export function isSingleResult(
	result: ExecutionOutput | undefined,
): result is ExecutionResult {
	return (
		typeof result === 'object' &&
		result !== null &&
		!('initialResult' in result) &&
		!(Symbol.asyncIterator in result)
	);
}

/**
 * Runs `onExecute` or `onSubscribe` around the executor: the hooks may swap
 * the function or provide the result, the after-hooks may replace it. Gives
 * back the result, or the outcome that ends the operation early (a hook or
 * the executor threw, or the operation was aborted).
 */
export async function runExecutionStage(
	rt: Runtime,
	{ request, state }: { request: Request; state: RequestState },
	args: ExecutionArgs,
	stageName: ExecutionStage,
	fallback: ExecuteFn = execute,
): Promise<StageRun> {
	const stage = await rt.engine.runners[stageName]({ request, state, args });
	let result: ExecutionOutput | undefined;
	let thrown: unknown;
	let aborted = false;
	if (stage.error === undefined) {
		try {
			result =
				stage.out.result ?? (await (stage.out.executeFn ?? fallback)(args));
		} catch (error) {
			if (args.abortSignal?.aborted) aborted = true;
			else thrown = error;
		}
	}
	const afterError = await settle(stage, {
		result,
		setResult: (next: ExecutionOutput) => {
			result = next;
		},
	});
	const error = thrown ?? afterError;
	if (error !== undefined) {
		await release(result);
		return { outcome: unexpected(error) };
	}
	if (aborted)
		return {
			outcome: failure('The operation was aborted.', {
				code: 'OPERATION_ABORTED',
				fix: 'Send the request again, and keep the connection open until the answer arrives.',
				// 499 (client closed request) when the client left, 503 otherwise (shutdown).
				status: request.signal.aborted ? 499 : 503,
			}),
		};
	return { result };
}
