import { GraxiaExecuteError } from '@graxia/core';
import type { CallToolResult } from '@modelcontextprotocol/server';
import { validate } from 'graphql';
import type { McpHost } from '../options';
import type { View } from '../view';
import { type Allowed, checkOperations, parseOperation } from './operation';
import { type JsonResult, refused, resultOf } from './result';

/** The input of `graphql_query` and `graphql_mutate`. */
export interface OperationInput {
	query: string;
	variables?: Record<string, unknown> | undefined;
	operationName?: string | undefined;
}

/** What one call runs against. */
export interface ExecuteContext {
	graxia: McpHost<any>;
	view: View;
	serverContext: object;
	headers: Headers;
	signal?: AbortSignal | undefined;
}

const SCHEMA_FIX =
	'Call graphql_schema (with { types: [...] } or { search }) to see the fields and arguments you may use, then correct the operation.';

const plain = (value: unknown): JsonResult =>
	JSON.parse(JSON.stringify(value)) as JsonResult;

/** Runs one operation of the tool's `kind` through `graxia.execute`, after checking it against the caller's view. */
export async function runOperation(
	kind: Allowed,
	input: OperationInput,
	context: ExecuteContext,
): Promise<CallToolResult> {
	const document = parseOperation(input.query);
	if ('message' in document)
		return refused(document.message, document.code, document.fix);
	const refusal = checkOperations(document, kind);
	if (refusal) return refused(refusal.message, refusal.code, refusal.fix);
	const problems = validate(context.view.schema, document);
	if (problems.length > 0)
		return resultOf({
			errors: problems.map((error) => ({
				...plain(error),
				extensions: { code: 'GRAPHQL_VALIDATION_FAILED', fix: SCHEMA_FIX },
			})),
		});
	try {
		const result = await context.graxia.execute({
			document: input.query,
			...(input.variables ? { variables: input.variables } : {}),
			...(input.operationName ? { operationName: input.operationName } : {}),
			headers: context.headers,
			...(context.signal ? { signal: context.signal } : {}),
			serverContext: context.serverContext,
		} as never);
		return resultOf(plain(result));
	} catch (error) {
		if (error instanceof GraxiaExecuteError)
			return refused(
				error.message,
				'MCP_EXECUTION_REFUSED',
				'Retry later; if it persists, the server is shutting down or a plugin refused the request.',
			);
		throw error;
	}
}
