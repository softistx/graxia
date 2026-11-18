import { type ExecutionArgs, type ExecutionResult, subscribe } from 'graphql';
import { eventStream, sseHeaders } from '../http/sse';
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
	if (isSingleResult(result)) return { kind: 'result', result };
	if (
		typeof result === 'object' &&
		result !== null &&
		Symbol.asyncIterator in result &&
		!('initialResult' in result)
	)
		return {
			kind: 'stream',
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

/** One payload on its way out: `onResultChunk` hooks first, then masking. */
async function payload(
	rt: Runtime,
	request: Request,
	state: RequestState,
	value: unknown,
): Promise<unknown> {
	const stage = await rt.engine.runners.onResultChunk({
		request,
		state,
		chunk: value,
	});
	if (stage.error !== undefined) throw stage.error;
	const chunk = stage.out.chunk;
	return typeof chunk === 'object' && chunk !== null && !Array.isArray(chunk)
		? rt.maskResult(chunk as ExecutionResult, state)
		: chunk;
}

/** The answer of an operation over SSE: its results as `next` events, then `complete`. */
export function streamResponse(
	rt: Runtime,
	call: {
		request: Request;
		state: RequestState;
		serverContext: Record<string, unknown>;
	},
	outcome: Extract<Outcome, { kind: 'stream' | 'result' }>,
): Response {
	const { request, state } = call;
	const live = outcome.kind === 'stream';
	if (live) releaseIdleTimeout(call.serverContext['server'], request);
	const once = (async function* () {
		yield (outcome as { result: ExecutionResult }).result;
	})();
	const stream = eventStream({
		source: live ? outcome.source : once,
		scope: live ? outcome.scope : (work) => work(),
		prepare: (value) => payload(rt, request, state, value),
		fail: (error) => {
			rt.unexpected.report(error, state, 'execution');
			return rt.unexpected.body(state);
		},
		keepAliveMs: rt.options.keepAliveMs,
		stop: AbortSignal.any([
			request.signal,
			rt.lifecycle.stopping,
			rt.lifecycle.shutdown,
		]),
		clientGone: request.signal,
		release: () => (live ? outcome.stop.abort() : undefined),
	});
	void rt.lifecycle.track(stream.done);
	return new Response(stream.body, { headers: sseHeaders() });
}

/**
 * Bun closes a connection idle for `idleTimeout` (10 s by default), which
 * would kill a stream between two events: this connection gets no timeout.
 */
function releaseIdleTimeout(server: unknown, request: Request): void {
	const bun = server as {
		timeout?: (request: Request, seconds: number) => void;
	};
	try {
		if (typeof bun?.timeout === 'function') bun.timeout(request, 0);
	} catch {
		// Not a Bun server: nothing to release.
	}
}
