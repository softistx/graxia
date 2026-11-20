import { type ExecutionResult, GraphQLError } from 'graphql';
import { own } from '../http/own-response';
import { payloadStream, type StreamFormat } from '../http/stream';
import type { RequestState } from '../plugins/state';
import { maskPayload } from './masking';
import type { Outcome } from './outcome';
import type { Runtime } from './runtime';

/** One payload on its way out: `onResultChunk` hooks first, then masking. Run it inside the operation's scope. */
export async function preparePayload(
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

/** What ends or silences a stream: the operation's own signals. */
export interface StreamSignals {
	/** Aborts when the stream must end now (the client left, the server is closing). */
	stop: AbortSignal;
	/** Aborts when the client left: nothing more is written, not even the format's end. */
	clientGone: AbortSignal;
}

/**
 * An operation's results as a stream of framed payloads (see `payloadStream`):
 * a stream outcome (a subscription, an incremental query) is pulled live; a
 * plain result is sent as the one and only payload. Shared by the HTTP
 * (`streamResponse`) and WebSocket transports.
 */
export function streamOutcome(
	rt: Runtime,
	call: { request: Request; state: RequestState },
	outcome: Extract<Outcome, { kind: 'stream' | 'result' }>,
	format: StreamFormat,
	signals: StreamSignals,
) {
	const { request, state } = call;
	const live = outcome.kind === 'stream';
	const once = (async function* () {
		yield (outcome as { result: ExecutionResult }).result;
	})();
	return payloadStream({
		format,
		source: live ? outcome.source : once,
		scope: outcome.scope ?? ((work) => work()),
		prepare: (value) => preparePayload(rt, request, state, value),
		fail: (error) => {
			// An error thrown while iterating a subscription takes the decision of an
			// execution error: a GraphQLError is exposed, anything else is masked and reported.
			if (error instanceof GraphQLError)
				return rt.maskResult({ errors: [error] }, state);
			rt.unexpected.report(error, state, 'execution');
			return rt.unexpected.body(state);
		},
		keepAliveMs: rt.options.keepAliveMs,
		...signals,
		release: () => (live ? outcome.stop.abort() : undefined),
	});
}

/**
 * What ends a stream now: the client leaving, the shutdown timeout, and, for
 * a subscription only, `dispose()` starting. An incremental query or mutation
 * drains like any other operation, within `shutdownTimeout`.
 */
export function streamStop(
	rt: Runtime,
	signal: AbortSignal,
	outcome: Extract<Outcome, { kind: 'stream' | 'result' }>,
): AbortSignal {
	const graceful = outcome.kind === 'stream' && outcome.subscription;
	return AbortSignal.any([
		signal,
		...(graceful ? [rt.lifecycle.stopping] : []),
		rt.lifecycle.shutdown,
	]);
}

/**
 * The answer of an operation as a stream response: its results framed by
 * `format` (SSE `next` events, multipart parts), the last one followed by the
 * format's end.
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
	const { request } = call;
	if (outcome.kind === 'stream')
		releaseIdleTimeout(call.serverContext['server'], request);
	const stream = streamOutcome(rt, call, outcome, format, {
		stop: streamStop(rt, request.signal, outcome),
		clientGone: request.signal,
	});
	void rt.lifecycle.track(stream.done);
	rt.telemetry.hold(call.state, stream.done);
	return own(new Response(stream.body, { headers: format.headers() }));
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
