import {
	type DocumentNode,
	type ExecutionArgs,
	type ExecutionResult,
	execute,
	Kind,
	type OperationDefinitionNode,
} from 'graphql';
import type { RequestState } from '../plugins/state';
import type { ExecutionOutput, GraphQLParams } from '../plugins/types';
import { runWithContext } from './context';
import { presetDocumentKey } from './execute-state';
import { failed, failure, type Outcome, settle, unexpected } from './outcome';
import type { Runtime } from './runtime';

/** Input of one operation: a POST body, a GET query, or one batch entry. */
export interface OperationInput {
	request: Request;
	state: RequestState;
	params: GraphQLParams;
	serverContext: Record<string, unknown>;
	method: 'GET' | 'POST';
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
	{ request, state, params, method }: OperationInput,
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
	if (operation.operation === 'subscription')
		return failure('Subscriptions are not supported over this transport yet.', {
			code: 'SUBSCRIPTION_NOT_SUPPORTED',
		});
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
	{ request, state, serverContext }: OperationInput,
	{ params, document, operation }: Prepared,
): Promise<Outcome> {
	// One context and one signal per operation, never shared with a batch sibling.
	const signal = AbortSignal.any([request.signal, rt.lifecycle.shutdown]);
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
	const run = () => execution(rt, { request, state }, args);
	return rt.options.asyncContext ? runWithContext(contextValue, run) : run();
}

async function execution(
	rt: Runtime,
	{ request, state }: Pick<OperationInput, 'request' | 'state'>,
	args: ExecutionArgs,
): Promise<Outcome> {
	const stage = await rt.engine.runners.onExecute({ request, state, args });
	let result: ExecutionOutput | undefined;
	let thrown: unknown;
	let aborted = false;
	if (stage.error === undefined) {
		try {
			result =
				stage.out.result ?? (await (stage.out.executeFn ?? execute)(args));
		} catch (error) {
			if (args.abortSignal?.aborted) aborted = true;
			else thrown = error;
		}
	}
	const afterError = await settle(stage, {
		result,
		setResult: (next: ExecutionOutput) => {
			result = next;
		},
	});
	const error = thrown ?? afterError;
	if (error !== undefined) {
		await release(result);
		return unexpected(error);
	}
	if (aborted)
		return failure('The operation was aborted.', {
			code: 'OPERATION_ABORTED',
			// 499 (client closed request) when the client left, 503 otherwise (shutdown).
			status: request.signal.aborted ? 499 : 503,
		});
	if (!isSingleResult(result)) {
		await release(result);
		return failure(
			'Incremental delivery (@defer, @stream) is not supported over this transport yet.',
			{ code: 'INCREMENTAL_NOT_SUPPORTED' },
		);
	}
	return { kind: 'result', result };
}

/** Ends a stream a custom executor returned, so its source is released. */
async function release(result: ExecutionOutput | undefined): Promise<void> {
	if (typeof result !== 'object' || result === null) return;
	const stream =
		Symbol.asyncIterator in result
			? (result as AsyncIterable<unknown>)[Symbol.asyncIterator]()
			: (result as { subsequentResults?: AsyncIterator<unknown> })
					.subsequentResults;
	try {
		await stream?.return?.();
	} catch {
		// Releasing is best effort.
	}
}

function isSingleResult(
	result: ExecutionOutput | undefined,
): result is ExecutionResult {
	return (
		typeof result === 'object' &&
		result !== null &&
		!('initialResult' in result) &&
		!(Symbol.asyncIterator in result)
	);
}
