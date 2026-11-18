import {
	type ExecutionArgs,
	experimentalExecuteIncrementally,
	legacyExecuteIncrementally,
} from 'graphql';
import type { RequestState } from '../plugins/state';
import type { ExecuteFn, ExecutionOutput } from '../plugins/types';
import { failure, type Outcome } from './outcome';
import type { Runtime } from './runtime';
import { isSingleResult, release, runExecutionStage } from './stage';

/** What a query's incremental result hands the transport. */
interface IncrementalResults {
	initialResult: unknown;
	subsequentResults: AsyncGenerator<unknown, void, void>;
}

const isIncremental = (
	result: ExecutionOutput | undefined,
): result is ExecutionOutput & IncrementalResults =>
	typeof result === 'object' &&
	result !== null &&
	'initialResult' in result &&
	typeof (result as { subsequentResults?: { next?: unknown } })
		.subsequentResults?.next === 'function';

/**
 * The executor of queries and mutations: graphql's incremental one in the
 * configured format. It also runs with `incremental: false` (graphql's plain
 * `execute` throws for a schema that declares `@defer`); an incremental
 * result is then refused.
 */
function executorOf(rt: Runtime): ExecuteFn {
	return (
		rt.options.incremental === 'legacy'
			? legacyExecuteIncrementally
			: experimentalExecuteIncrementally
	) as ExecuteFn;
}

/**
 * The payloads of an incremental result as one source: the initial result,
 * then each subsequent one. `return()` ends the subsequent results at once,
 * even while one is pending (it is not a generator, so nothing queues it).
 */
function sourceOf(results: IncrementalResults): AsyncIterator<unknown> {
	let initial = true;
	return {
		next() {
			if (!initial) return results.subsequentResults.next();
			initial = false;
			return Promise.resolve({ done: false, value: results.initialResult });
		},
		return: () => results.subsequentResults.return(),
	};
}

/**
 * Runs a query or a mutation (`onExecute` around the executor). Gives a
 * `result` for one answer, or, when `@defer` or `@stream` made it incremental
 * and the request can stream (`multipart/mixed` or `text/event-stream`), a
 * `stream` outcome. Over plain JSON, or with `incremental: false`, it is
 * refused with `INCREMENTAL_NOT_SUPPORTED` and its source released.
 */
export async function execution(
	rt: Runtime,
	call: { request: Request; state: RequestState },
	args: ExecutionArgs,
	stream: {
		/** The request accepts a streamed answer. */
		allowed: boolean;
		stop: AbortController;
		scope: <T>(work: () => T) => T;
	},
): Promise<Outcome> {
	const run = await runExecutionStage(
		rt,
		call,
		args,
		'onExecute',
		executorOf(rt),
	);
	if ('outcome' in run) return run.outcome;
	const { result } = run;
	if (isSingleResult(result)) return { kind: 'result', result };
	if (
		rt.options.incremental !== false &&
		stream.allowed &&
		isIncremental(result)
	)
		return {
			kind: 'stream',
			source: sourceOf(result),
			stop: stream.stop,
			scope: stream.scope,
		};
	await release(result);
	return failure(
		rt.options.incremental === false
			? 'Incremental delivery (@defer, @stream) is disabled (incremental is false).'
			: 'Incremental delivery (@defer, @stream) needs "Accept: multipart/mixed" or "Accept: text/event-stream".',
		{ code: 'INCREMENTAL_NOT_SUPPORTED' },
	);
}
