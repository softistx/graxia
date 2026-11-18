import type { GraphQLSchema, OperationDefinitionNode } from 'graphql';
import type { RequestState } from '../plugins/state';
import type { GraphQLParams } from '../plugins/types';
import type { Outcome } from '../server/outcome';
import { settleOutcome } from './operation';
import { bindResolvers } from './resolvers';
import {
	ATTR,
	documentIdOf,
	type Env,
	fail,
	type Operation,
	operationKey,
	parentOf,
	quietKey,
	SPAN,
	start,
} from './spans';

/** What a validation or parse step reports back to its span. */
export interface StepLike {
	errors?: readonly unknown[] | undefined;
	error?: unknown;
	cacheHit?: boolean | undefined;
}

/** Runs one operation in its span, which ends with the outcome (a stream: with the stream). */
export async function traceOperation(
	env: Env,
	schema: GraphQLSchema,
	state: RequestState,
	run: () => Promise<Outcome>,
): Promise<Outcome> {
	if (state.get(quietKey)) return run();
	const live = start(
		env,
		SPAN.operation,
		env.api.SpanKind.INTERNAL,
		parentOf(env, state),
	);
	const op: Operation = { live, errors: 0, events: 0, ended: false };
	state.set(operationKey, op);
	const inContext = <T>(work: () => T) => env.api.context.with(live.ctx, work);
	try {
		const outcome = await inContext(run);
		return settleOutcome(env, schema, op, outcome, inContext);
	} catch (error) {
		fail(env, live.span, error);
		live.span.end();
		op.ended = true;
		throw error;
	}
}

/** Names the operation span and sets its attributes once the operation is chosen. */
export function describeOperation(
	env: Env,
	state: RequestState,
	info: {
		operation: OperationDefinitionNode;
		source: string;
		params: GraphQLParams;
	},
): void {
	const op = state.get(operationKey);
	if (!op) return;
	const { operation, source, params } = info;
	const name = operation.name?.value;
	const span = op.live.span;
	span.updateName(
		name ? `${operation.operation} ${name}` : operation.operation,
	);
	span.setAttribute(ATTR.operationType, operation.operation);
	if (name) span.setAttribute(ATTR.operationName, name);
	if (env.document) span.setAttribute(ATTR.document, source);
	const id = documentIdOf(params);
	if (id) span.setAttribute(ATTR.documentId, id);
}

/** Runs the parse or validate step in a span of its own. */
export async function traceStep<R extends StepLike>(
	env: Env,
	state: RequestState,
	name: 'parse' | 'validate',
	run: () => Promise<R>,
): Promise<R> {
	if (state.get(quietKey)) return run();
	const live = start(
		env,
		name === 'parse' ? SPAN.parse : SPAN.validate,
		env.api.SpanKind.INTERNAL,
		parentOf(env, state),
	);
	try {
		const result = await run();
		if (result.cacheHit !== undefined)
			live.span.setAttribute(ATTR.cacheHit, result.cacheHit);
		if (result.errors?.length)
			live.span.setAttribute(ATTR.errorCount, result.errors.length);
		if (result.error !== undefined) fail(env, live.span, result.error);
		return result;
	} catch (error) {
		fail(env, live.span, error);
		throw error;
	} finally {
		live.span.end();
	}
}

/** Makes `scope` run inside the operation span's context, and traces the resolvers of `contextValue`. */
export function traceScope(
	env: Env,
	trivial: boolean | undefined,
	state: RequestState,
	contextValue: object,
	scope: <T>(work: () => T) => T,
): <T>(work: () => T) => T {
	const op = state.get(operationKey);
	if (!op) return scope;
	if (trivial !== undefined)
		bindResolvers(contextValue, env, op.live.ctx, trivial);
	return (work) => env.api.context.with(op.live.ctx, () => scope(work));
}
