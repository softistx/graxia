import {
	type DocumentNode,
	type ExecutionArgs,
	Kind,
	type OperationDefinitionNode,
} from 'graphql';
import { costRefusal } from '../limits/cost';
import type { RequestState } from '../plugins/state';
import type { GraphQLParams } from '../plugins/types';
import { runWithContext } from './context';
import { presetDocumentKey } from './execute-state';
import { execution } from './incremental';
import { failed, failure, type Outcome, settle, unexpected } from './outcome';
import type { Runtime } from './runtime';
import { subscription } from './subscription';

/** Input of one operation: a POST body, a GET query, or one batch entry. */
export interface OperationInput {
	request: Request;
	state: RequestState;
	params: GraphQLParams;
	serverContext: Record<string, unknown>;
	method: 'GET' | 'POST';
	/** The client asked for `text/event-stream`: a subscription becomes a stream. */
	sse?: boolean;
	/** The client asked for `multipart/mixed`: an incremental query becomes a stream. */
	multipart?: boolean;
}

interface Prepared {
	params: GraphQLParams;
	document: DocumentNode;
	operation: OperationDefinitionNode;
}

const isPrepared = (value: Outcome | Prepared): value is Prepared =>
	!('kind' in value);

/** The pre-parsed document `execute` gave, while the query is still the text it printed. */
function presetFor(state: RequestState, query: string) {
	const preset = state.get(presetDocumentKey);
	return preset?.text === query ? preset.node : undefined;
}

/**
 * Runs one operation through the pipeline (onParams, parse, validate,
 * operation selection, context, onExecute, execute). Never rejects: a hook
 * error or a throw becomes an `unexpected` outcome.
 */
export async function runOperation(
	rt: Runtime,
	input: OperationInput,
): Promise<Outcome> {
	try {
		const prepared = await prepare(rt, input);
		if (!isPrepared(prepared)) return prepared;
		return await executeOperation(rt, input, prepared);
	} catch (error) {
		return unexpected(error);
	}
}

async function prepare(
	rt: Runtime,
	{ request, state, params, method, sse }: OperationInput,
): Promise<Outcome | Prepared> {
	const stage = await rt.engine.runners.onParams({ request, state, params });
	const error = await settle(stage, { params: stage.out.params });
	if (error !== undefined) return unexpected(error);
	if (stage.out.response)
		return { kind: 'response', response: stage.out.response };
	const final = stage.out.params;
	if (typeof final.query !== 'string' || final.query === '')
		return failure('Must provide a query string.', { status: 400 });
	const parsed = await rt.pipeline.parse({
		source: final.query,
		state,
		request,
		document: presetFor(state, final.query),
	});
	if (parsed.error !== undefined) return unexpected(parsed.error);
	if (parsed.errors || !parsed.document) return failed(parsed.errors ?? []);
	const early = selectOperation(parsed.document, final.operationName);
	if (
		typeof early !== 'string' &&
		early.operation === 'mutation' &&
		method === 'GET'
	)
		return failure(
			'Can only perform a mutation operation from a POST request.',
			{
				status: 405,
				headers: { allow: 'POST' },
			},
		);
	const valid = await rt.pipeline.validate({
		document: parsed.document,
		cacheKey: parsed.cacheKey,
		state,
		request,
	});
	if (valid.error !== undefined) return unexpected(valid.error);
	if (valid.errors) return failed(valid.errors);
	const operation = selectOperation(parsed.document, final.operationName);
	if (typeof operation === 'string') return failure(operation);
	const { cost } = rt.options.operationLimits;
	if (cost) {
		const over = costRefusal(
			rt.schema,
			parsed.document,
			operation,
			final.variables,
			cost,
		);
		if (over) return failed(over);
	}
	if (operation.operation === 'subscription' && !sse)
		return failure(
			subscriptionRefusal(rt.options.sse, rt.options.ws !== false),
			{
				code: 'SUBSCRIPTION_NOT_SUPPORTED',
			},
		);
	return { params: final, document: parsed.document, operation };
}

/** The operation to run, or the message explaining why none can be picked. */
function selectOperation(
	document: DocumentNode,
	name: string | undefined,
): OperationDefinitionNode | string {
	const operations = document.definitions.filter(
		(d): d is OperationDefinitionNode => d.kind === Kind.OPERATION_DEFINITION,
	);
	if (name !== undefined) {
		const found = operations.filter((o) => o.name?.value === name);
		return found.length === 1
			? (found[0] as OperationDefinitionNode)
			: `Unknown operation named "${name}".`;
	}
	if (operations.length === 1) return operations[0] as OperationDefinitionNode;
	return operations.length === 0
		? 'Must provide an operation.'
		: 'Must provide operation name if query contains multiple operations.';
}

async function executeOperation(
	rt: Runtime,
	{ request, state, serverContext, sse, multipart }: OperationInput,
	{ params, document, operation }: Prepared,
): Promise<Outcome> {
	// One context and one signal per operation, never shared with a batch sibling.
	const stop = new AbortController();
	const signal = AbortSignal.any([
		request.signal,
		rt.lifecycle.shutdown,
		stop.signal,
	]);
	const extra = rt.context
		? await rt.context({ request, serverContext, params, signal })
		: {};
	const ctx = await rt.engine.runners.onContext({
		request,
		state,
		context: { ...serverContext, ...extra, signal },
	});
	const ctxError = await settle(ctx, undefined);
	if (ctxError !== undefined) return unexpected(ctxError);
	const contextValue = { ...ctx.out.context, signal };
	const args: ExecutionArgs = {
		schema: rt.schema,
		document,
		// `signal` is set again: a plugin cannot make it diverge from `abortSignal`.
		contextValue,
		abortSignal: signal,
		...(params.variables ? { variableValues: params.variables } : {}),
		...(operation.name ? { operationName: operation.name.value } : {}),
	};
	const scope = <T>(work: () => T): T =>
		rt.options.asyncContext ? runWithContext(contextValue, work) : work();
	const call = { request, state };
	return operation.operation === 'subscription'
		? scope(() => subscription(rt, call, args, { stop, scope }))
		: scope(() =>
				execution(rt, call, args, {
					allowed: Boolean(sse || multipart),
					stop,
					scope,
				}),
			);
}

/** Why a subscription sent as plain JSON is refused, naming the transports that are on. */
function subscriptionRefusal(sse: boolean, ws: boolean): string {
	if (sse && ws)
		return 'Subscriptions are served over server-sent events (send "Accept: text/event-stream") or WebSocket (graphql-transport-ws).';
	if (sse)
		return 'Subscriptions are served over server-sent events: send "Accept: text/event-stream".';
	if (ws)
		return 'Subscriptions are served over WebSocket (graphql-transport-ws); subscriptions.sse is false.';
	return 'Subscriptions are not supported over this transport (subscriptions.sse is false).';
}
