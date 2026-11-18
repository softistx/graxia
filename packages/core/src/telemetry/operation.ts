import type { ExecutionResult, GraphQLSchema } from 'graphql';
import { isExposed } from '../errors/mask';
import type { Outcome } from '../server/outcome';
import { ATTR, type Env, EVENT_NAME, fail, type Operation } from './spans';

/** Counts the errors of one payload and records the unexpected ones (the ones that get masked). */
export function observePayload(
	env: Env,
	schema: GraphQLSchema,
	op: Operation,
	payload: unknown,
): void {
	if (typeof payload !== 'object' || payload === null) return;
	const record = payload as Record<string, unknown>;
	const lists = [record['errors']];
	for (const key of ['incremental', 'completed']) {
		const entries = record[key];
		if (Array.isArray(entries))
			for (const entry of entries)
				lists.push((entry as ExecutionResult).errors);
	}
	for (const list of lists) {
		if (!Array.isArray(list)) continue;
		op.errors += list.length;
		for (const error of list) {
			if (!(error instanceof Error) || !('originalError' in error)) continue;
			const cause = (error as any).originalError;
			if (cause !== undefined && !isExposed(error as any, schema))
				fail(env, op.live.span, cause);
		}
	}
}

/** Ends the operation span once, with its error count (and event count for a stream). */
export function endOperation(op: Operation, streamed: boolean): void {
	if (op.ended) return;
	op.ended = true;
	if (op.errors > 0) op.live.span.setAttribute(ATTR.errorCount, op.errors);
	if (streamed) op.live.span.setAttribute(ATTR.events, op.events);
	op.live.span.end();
}

/** The source of a stream outcome, counting each payload as a span event and ending the span with the stream. */
export function observeSource(
	env: Env,
	schema: GraphQLSchema,
	op: Operation,
	source: AsyncIterator<unknown>,
): AsyncIterator<unknown> {
	return {
		async next() {
			try {
				const step = await source.next();
				if (step.done) endOperation(op, true);
				else {
					op.events++;
					op.live.span.addEvent(EVENT_NAME, {
						'graxia.event.index': op.events,
					});
					observePayload(env, schema, op, step.value);
				}
				return step;
			} catch (error) {
				fail(env, op.live.span, error);
				endOperation(op, true);
				throw error;
			}
		},
		async return(value?: unknown) {
			try {
				return source.return
					? await source.return(value)
					: { done: true as const, value };
			} finally {
				endOperation(op, true);
			}
		},
	};
}

/** Ends the span of an operation that is over, or hands a stream outcome a source that ends it. */
export function settleOutcome(
	env: Env,
	schema: GraphQLSchema,
	op: Operation,
	outcome: Outcome,
	scope: (work: () => unknown) => unknown,
): Outcome {
	switch (outcome.kind) {
		case 'result':
			observePayload(env, schema, op, outcome.result);
			endOperation(op, false);
			return outcome;
		case 'unexpected':
			fail(env, op.live.span, outcome.error);
			endOperation(op, false);
			return outcome;
		case 'stream': {
			outcome.stop.signal.addEventListener(
				'abort',
				() => endOperation(op, true),
				{
					once: true,
				},
			);
			const inner = outcome.scope;
			return {
				...outcome,
				source: observeSource(env, schema, op, outcome.source),
				scope: ((work: () => unknown) =>
					scope(() => inner(work))) as typeof inner,
			};
		}
		default:
			endOperation(op, false);
			return outcome;
	}
}
