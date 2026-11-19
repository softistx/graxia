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
	const live = start(env, SPAN.operation, parentOf(state), {
		kind: 'internal',
	});
	const op: Operation = { live, errors: 0, events: 0, ended: false };
	state.set(operationKey, op);
	const inContext = <T>(work: () => T) => live.run(work);
	try {
		const outcome = await inContext(run);
		return settleOutcome(schema, op, outcome, inContext);
	} catch (error) {
		fail(live, error);
		live.end();
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
	const span = op.live;
	span.name = name ? `${operation.operation} ${name}` : operation.operation;
	span.attribute(ATTR.operationType, operation.operation);
	if (name) span.attribute(ATTR.operationName, name);
	if (env.document) span.attribute(ATTR.document, source);
	const id = documentIdOf(params);
	if (id) span.attribute(ATTR.documentId, id);
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
		parentOf(state),
		{ kind: 'internal' },
	);
	try {
		const result = await run();
		if (result.cacheHit !== undefined)
			live.attribute(ATTR.cacheHit, result.cacheHit);
		if (result.errors?.length)
			live.attribute(ATTR.errorCount, result.errors.length);
		if (result.error !== undefined) fail(live, result.error);
		return result;
	} catch (error) {
		fail(live, error);
		throw error;
	} finally {
		live.end();
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
	if (trivial !== undefined) bindResolvers(contextValue, env, op.live, trivial);
	return (work) => op.live.run(() => scope(work));
}
