import { type DocumentNode, Kind, type OperationDefinitionNode } from 'graphql';
import type { RequestState } from '../plugins/state';
import type { GraphQLParams } from '../plugins/types';
import { presetDocumentKey } from './execute-state';
import type { OperationInput } from './operation';
import { failed, failure, type Outcome, settle, unexpected } from './outcome';
import type { Runtime } from './runtime';

/** The params a request settled on after `onParams`, with a non-empty query. */
export interface Settled {
	params: GraphQLParams;
	query: string;
	register: (() => void) | undefined;
}

/** A parsed document, with the key `validate` reuses. */
export interface Parsed {
	document: DocumentNode;
	cacheKey: string | undefined;
}

/** The pre-parsed document `execute` gave, while the query is still the text it printed. */
export function presetFor(state: RequestState, query: string) {
	const preset = state.get(presetDocumentKey);
	return preset?.text === query ? preset.node : undefined;
}

/** Trusted documents and `onParams`: the params the rest of the pipeline works on. */
export async function settleParams(
	rt: Runtime,
	{ request, state, params }: OperationInput,
): Promise<Outcome | Settled> {
	const trusted = await rt.trusted?.resolve(params, request, state);
	if (trusted && !trusted.ok)
		return failure(trusted.message, {
			code: trusted.code,
			...(trusted.status !== undefined ? { status: trusted.status } : {}),
			fix: trusted.fix,
		});
	const stage = await rt.engine.runners.onParams({
		request,
		state,
		params: trusted ? trusted.params : params,
	});
	const error = await settle(stage, { params: stage.out.params });
	if (error !== undefined) return unexpected(error);
	if (stage.out.response)
		return { kind: 'response', response: stage.out.response };
	const final = stage.out.params;
	if (typeof final.query !== 'string' || final.query === '')
		return failure('Must provide a query string.', {
			status: 400,
			code: 'MISSING_QUERY',
			fix: 'Send a "query" string, or a "documentId" when trusted documents are on.',
		});
	return { params: final, query: final.query, register: trusted?.register };
}

/** The parse step, the operation span's name, and the early refusal of a mutation over GET. */
export async function parseStep(
	rt: Runtime,
	{ request, state, params, method }: OperationInput,
	settled: Settled,
): Promise<Outcome | Parsed> {
	const { query } = settled;
	const parsed = await rt.telemetry.step(state, 'parse', () =>
		rt.pipeline.parse({
			source: query,
			state,
			request,
			document: presetFor(state, query),
		}),
	);
	if (parsed.error !== undefined) return unexpected(parsed.error);
	if (parsed.errors || !parsed.document) return failed(parsed.errors ?? []);
	const early = selectOperation(parsed.document, settled.params.operationName);
	if (typeof early !== 'string') {
		rt.telemetry.describe(state, { operation: early, source: query, params });
		if (early.operation === 'mutation' && method === 'GET')
			return failure(
				'Can only perform a mutation operation from a POST request.',
				{
					status: 405,
					code: 'METHOD_NOT_ALLOWED',
					headers: { allow: 'POST' },
					fix: 'Send the mutation with POST.',
				},
			);
	}
	return { document: parsed.document, cacheKey: parsed.cacheKey };
}

/** The validate step: an outcome when the document is refused, else nothing. */
export async function validateStep(
	rt: Runtime,
	{ request, state }: OperationInput,
	{ document, cacheKey }: Parsed,
): Promise<Outcome | undefined> {
	const valid = await rt.telemetry.step(state, 'validate', () =>
		rt.pipeline.validate({ document, cacheKey, state, request }),
	);
	if (valid.error !== undefined) return unexpected(valid.error);
	if (valid.errors) return failed(valid.errors);
	return undefined;
}

/** The operation to run, or the message explaining why none can be picked. */
export function selectOperation(
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
