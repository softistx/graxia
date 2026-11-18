import type { ExecutionResult } from 'graphql';
import { payloadStream, type StreamFormat } from '../http/stream';
import type { RequestState } from '../plugins/state';
import { maskPayload } from './masking';
import type { Outcome } from './outcome';
import type { Runtime } from './runtime';

/** One payload on its way out: `onResultChunk` hooks first, then masking. */
async function payload(
	rt: Runtime,
	request: Request,
	state: RequestState,
	value: unknown,
): Promise<unknown> {
	// Called inside the operation's scope (see `payloadStream`).
	const stage = await rt.engine.runners.onResultChunk({
		request,
		state,
		chunk: value,
	});
	if (stage.error !== undefined) throw stage.error;
	const chunk = stage.out.chunk;
	return typeof chunk === 'object' && chunk !== null && !Array.isArray(chunk)
		? maskPayload(rt.maskResult, chunk as ExecutionResult, state)
		: chunk;
}

/**
 * The answer of an operation as a stream: its results framed by `format` (SSE
 * `next` events, multipart parts), the last one followed by the format's end.
 * A stream outcome (a subscription, an incremental query) is pulled live; a
 * plain result is sent as the one and only payload.
 */
export function streamResponse(
	rt: Runtime,
	call: {
		request: Request;
		state: RequestState;
		serverContext: Record<string, unknown>;
	},
	outcome: Extract<Outcome, { kind: 'stream' | 'result' }>,
	format: StreamFormat,
): Response {
	const { request, state } = call;
	const live = outcome.kind === 'stream';
	if (live) releaseIdleTimeout(call.serverContext['server'], request);
	const once = (async function* () {
		yield (outcome as { result: ExecutionResult }).result;
	})();
	const stream = payloadStream({
		format,
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
	return new Response(stream.body, { headers: format.headers() });
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
