import { GraxiaExecuteError } from '@graxia/core';
import type { CallToolResult } from '@modelcontextprotocol/server';
import { validate } from 'graphql';
import type { McpHost } from '../options';
import type { View } from '../view';
import {
	type Allowed,
	checkOperations,
	INTROSPECTION_FIX,
	parseOperation,
	VIEW_RULES,
} from './operation';
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
	/** The caller's view, built on first use. */
	view: () => Promise<View>;
	serverContext: object;
	headers: Headers;
	signal?: AbortSignal | undefined;
	/** The scope `graphql_mutate` needs, when `auth` is on: named in the fix of a mutation sent to `graphql_query`. */
	writeScope?: string | undefined;
	/** Receives an unexpected failure with its cause. */
	onError: (error: unknown) => void;
}

const SCHEMA_FIX =
	'Call graphql_schema (with { types: [...] } or { search }) to see the fields and arguments you may use, then correct the operation.';

const plain = (value: unknown): JsonResult =>
	JSON.parse(JSON.stringify(value)) as JsonResult;

/** The errors graxia's own response carries (a plugin's `respond`, a refusal), so the agent keeps their code and fix. */
async function errorsOf(error: GraxiaExecuteError): Promise<CallToolResult> {
	try {
		const body = (await error.response.clone().json()) as JsonResult;
		if (Array.isArray(body?.errors) && body.errors.length > 0)
			return resultOf({ errors: body.errors });
	} catch {}
	return refused(
		error.message,
		'MCP_EXECUTION_REFUSED',
		'Retry later; if it persists, the server is shutting down or a plugin refused the request.',
	);
}

/** Runs one operation of the tool's `kind` through `graxia.execute`, after checking it against the caller's view. */
export async function runOperation(
	kind: Allowed,
	input: OperationInput,
	context: ExecuteContext,
): Promise<CallToolResult> {
	const parsed = parseOperation(input.query, context.graxia.limits.tokens);
	if ('refusal' in parsed)
		return refused(
			parsed.refusal.message,
			parsed.refusal.code,
			parsed.refusal.fix,
		);
	const { document } = parsed;
	const refusal = checkOperations(
		document,
		kind,
		input.operationName,
		context.writeScope,
	);
	if (refusal) return refused(refusal.message, refusal.code, refusal.fix);
	const problems = validate(
		(await context.view()).schema,
		document,
		VIEW_RULES,
	);
	if (problems.length > 0)
		return resultOf({
			errors: problems.map((error) => ({
				...plain(error),
				extensions: {
					code: 'GRAPHQL_VALIDATION_FAILED',
					fix: /introspection/i.test(error.message)
						? INTROSPECTION_FIX
						: SCHEMA_FIX,
				},
			})),
		});
	return execute(context, {
		document: input.query,
		variables: input.variables,
		operationName: input.operationName,
	});
}

/** Runs a document through `graxia.execute` with the caller's headers and `serverContext`; graxia's refusals keep their code and fix. */
export async function execute(
	context: ExecuteContext,
	operation: {
		document: string;
		variables?: Record<string, unknown> | undefined;
		operationName?: string | undefined;
	},
): Promise<CallToolResult> {
	try {
		const result = await context.graxia.execute({
			document: operation.document,
			...(operation.variables ? { variables: operation.variables } : {}),
			...(operation.operationName
				? { operationName: operation.operationName }
				: {}),
			headers: context.headers,
			...(context.signal ? { signal: context.signal } : {}),
			serverContext: context.serverContext,
		});
		return resultOf(plain(result));
	} catch (error) {
		if (error instanceof GraxiaExecuteError) return errorsOf(error);
		throw error;
	}
}
