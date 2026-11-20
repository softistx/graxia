import { type Env, fail, type Live, SPAN, start } from './spans';

/** An abort or a timeout: a shutdown or a client leaving, not a failure worth a span of its own. */
const isCancellation = (cause: unknown) =>
	cause instanceof Error &&
	(cause.name === 'AbortError' || cause.name === 'TimeoutError');

/**
 * The stand-in for the operation span when `operationSpans` is `false`: it makes no span of its
 * own and runs work as is, so the spans started inside hang under the host's active span. The
 * cause of a masked error is kept as a short `graphql.error` span, failed, under that same span.
 */
export function hostSpan(env: Env): Live {
	return {
		name: '',
		status: 'ok',
		context: { sampled: true },
		attribute: () => {},
		event: () => {},
		fail: (cause) => {
			if (isCancellation(cause)) return;
			const span = start(env, SPAN.error, undefined, { kind: 'internal' });
			fail(span, cause);
			span.end();
		},
		end: () => {},
		run: (work) => work(),
	};
}
