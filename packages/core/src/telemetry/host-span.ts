import type { HostScope } from './api';
import { type Env, fail, recorded, SPAN, type StandIn, start } from './spans';

/** An abort or a timeout: a shutdown or a client leaving, not a failure worth a span of its own. */
const isCancellation = (cause: unknown) =>
	cause instanceof Error &&
	(cause.name === 'AbortError' || cause.name === 'TimeoutError');

/**
 * The stand-in for the operation span when `operationSpans` is `false` and a host span is active:
 * it makes no span of its own and runs work as is, so the spans started inside hang under the
 * host's active span (or, with no active span, under the host's span at the request, by its
 * `traceparent`). Attributes go on the host's span; it is never renamed, failed or ended. The
 * cause of a masked error is a short failed `graphql.error` span, unless a resolver span already
 * recorded it.
 */
export function hostSpan(env: Env, host: HostScope): StandIn {
	const standIn: StandIn = {
		name: '',
		status: 'ok',
		context: { sampled: true },
		traceparent: host.traceparent(),
		attribute: (name, value) => host.attribute(name, value),
		event: () => {},
		fail: (cause) => {
			if (isCancellation(cause)) return;
			if (typeof cause === 'object' && cause !== null && recorded.has(cause))
				return;
			const span = start(env, SPAN.error, standIn, { kind: 'internal' });
			fail(span, cause);
			span.end();
		},
		end: () => {},
		run: (work) => work(),
	};
	return standIn;
}
