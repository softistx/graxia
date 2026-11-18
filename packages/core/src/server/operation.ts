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
	});
	if (parsed.error !== undefined) return unexpected(parsed.error);
	if (parsed.errors || !parsed.document) return failed(parsed.errors ?? []);
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
	if (operation.operation === 'mutation' && method === 'GET')
		return failure(
			'Can only perform a mutation operation from a POST request.',
			{
				status: 405,
				headers: { allow: 'POST' },
			},
		);
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
	const extra = rt.context
		? await rt.context({ request, serverContext, params })
		: {};
	const ctx = await rt.engine.runners.onContext({
		request,
		state,
		context: { ...serverContext, ...extra },
	});
	const ctxError = await settle(ctx, undefined);
	if (ctxError !== undefined) return unexpected(ctxError);
	const args: ExecutionArgs = {
		schema: rt.schema,
		document,
		contextValue: ctx.out.context,
		...(params.variables ? { variableValues: params.variables } : {}),
		...(operation.name ? { operationName: operation.name.value } : {}),
	};
	const stage = await rt.engine.runners.onExecute({ request, state, args });
	let result: ExecutionOutput | undefined =
		stage.error === undefined ? stage.out.result : undefined;
	if (stage.error === undefined && result === undefined)
		result = await (stage.out.executeFn ?? execute)(args);
	const error = await settle(stage, {
		result,
		setResult: (next: ExecutionOutput) => {
			result = next;
		},
	});
	if (error !== undefined) return unexpected(error);
	if (!isSingleResult(result))
		return failure(
			'Incremental delivery (@defer, @stream) is not supported over this transport yet.',
			{ code: 'INCREMENTAL_NOT_SUPPORTED' },
		);
	return { kind: 'result', result };
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
