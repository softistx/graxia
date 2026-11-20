import { type Env, fail, recorded, SPAN, type StandIn, start } from './spans';

/** An abort or a timeout: a shutdown or a client leaving, not a failure worth a span of its own. */
const isCancellation = (cause: unknown) =>
	cause instanceof Error &&
	(cause.name === 'AbortError' || cause.name === 'TimeoutError');

/**
 * The stand-in for the operation span when `operationSpans` is `false` and a host span is active:
 * it makes no span of its own and runs work as is, so the spans started inside hang under the
 * host's active span (or, with no active span, under `traceparent`, the host's span at the request).
 *
 * Temporary, until nxgt-telemetry#62: `currentSpan()` is read-only, so the operation attributes
 * go on the validate span and the cause of a masked error is a short failed `graphql.error` span,
 * unless a resolver span already recorded it.
 */
export function hostSpan(env: Env, traceparent: string): StandIn {
	return {
		name: '',
		status: 'ok',
		context: { sampled: true },
		traceparent,
		attribute: () => {},
		event: () => {},
		fail: (cause) => {
			if (isCancellation(cause)) return;
			if (typeof cause === 'object' && cause !== null && recorded.has(cause))
				return;
			const span = start(env, SPAN.error, undefined, { kind: 'internal' });
			fail(span, cause);
			span.end();
		},
		end: () => {},
		run: (work) => work(),
	};
}
