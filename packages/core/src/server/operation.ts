import type {
	DocumentNode,
	ExecutionArgs,
	OperationDefinitionNode,
} from 'graphql';
import { costRefusal } from '../limits/operation-cost';
import type { RequestState } from '../plugins/state';
import type { GraphQLParams } from '../plugins/types';
import { runWithContext } from './context';
import { withHttpRefusal } from './http-refusal';
import { execution } from './incremental';
import {
	parseStep,
	selectOperation,
	settleParams,
	validateStep,
} from './operation-steps';
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

const isOutcome = (value: object): value is Outcome => 'kind' in value;

/**
 * Runs one operation through the pipeline (onParams, parse, validate,
 * operation selection, context, onExecute, execute). Never rejects: a hook
 * error or a throw becomes an `unexpected` outcome.
 */
export function runOperation(
	rt: Runtime,
	input: OperationInput,
): Promise<Outcome> {
	return rt.telemetry.operation(input.state, () => run(rt, input));
}

async function run(rt: Runtime, input: OperationInput): Promise<Outcome> {
	try {
		const prepared = await prepare(rt, input);
		if (isOutcome(prepared)) return prepared;
		return await executeOperation(rt, input, prepared);
	} catch (error) {
		return unexpected(error);
	}
}

async function prepare(
	rt: Runtime,
	input: OperationInput,
): Promise<Outcome | Prepared> {
	const settled = await settleParams(rt, input);
	if (isOutcome(settled)) return settled;
	const { params: final } = settled;
	const parsed = await parseStep(rt, input, settled);
	if (isOutcome(parsed)) return parsed;
	const refused = await validateStep(rt, input, parsed);
	if (refused) return refused;
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
	if (operation.operation === 'subscription' && !input.sse)
		return failure(
			subscriptionRefusal(rt.options.sse, rt.options.ws !== false),
			{ code: 'SUBSCRIPTION_NOT_SUPPORTED' },
		);
	// Only a document that passed every check is stored, and only the query the
	// client sent, never one a plugin rewrote.
	if (final.query === input.params.query) settled.register?.();
	return { params: final, document: parsed.document, operation };
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
		hideSuggestions: !rt.options.suggestions,
		...(params.variables ? { variableValues: params.variables } : {}),
		...(operation.name ? { operationName: operation.name.value } : {}),
	};
	const scope = rt.telemetry.scope(
		state,
		contextValue,
		<T>(work: () => T): T =>
			rt.options.asyncContext ? runWithContext(contextValue, work) : work(),
	);
	const call = { request, state };
	const outcome =
		operation.operation === 'subscription'
			? scope(() => subscription(rt, call, args, { stop, scope }))
			: scope(() =>
					execution(rt, call, args, {
						allowed: Boolean(sse || multipart),
						stop,
						scope,
					}),
				);
	return withHttpRefusal(state, await outcome);
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
