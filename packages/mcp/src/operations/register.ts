import type {
	CallToolResult,
	McpServer,
	StandardSchemaWithJSON,
} from '@modelcontextprotocol/server';
import { type ExecuteContext, execute } from '../tools/execute';
import { failed, guarded } from '../tools/guard';
import { type JsonResult, refused, resultOf } from '../tools/result';
import type { JsonSchema, OperationTool } from './types';

/**
 * A JSON Schema as the SDK takes it: advertised as it is, and accepting any
 * value. The arguments are checked by graxia's own variable coercion, whose
 * errors carry a code and a fix.
 */
export function advertised(
	schema: JsonSchema,
): StandardSchemaWithJSON<Record<string, unknown>> {
	return {
		'~standard': {
			version: 1,
			vendor: 'graxia',
			jsonSchema: { input: () => schema, output: () => schema },
			validate: (value) => ({ value: value as Record<string, unknown> }),
		},
	};
}

/** The fix of a variable graxia refused: an agent has the input schema, not the operation. */
export const ARGUMENTS_FIX =
	"Correct the arguments: see the tool's input schema.";

/** The refusal of arguments the input schema does not have; graphql would drop them silently. */
function unknownArguments(
	tool: OperationTool,
	variables: Record<string, unknown>,
): CallToolResult | undefined {
	const accepted = Object.keys(
		(tool.inputSchema['properties'] ?? {}) as Record<string, unknown>,
	);
	const unknown = Object.keys(variables).filter(
		(key) => !accepted.includes(key),
	);
	if (unknown.length === 0) return undefined;
	return refused(
		`${tool.name} does not take the argument${unknown.length === 1 ? '' : 's'} ${unknown.join(', ')}.`,
		'MCP_UNKNOWN_ARGUMENT',
		accepted.length > 0
			? `Send only the arguments the tool accepts: ${accepted.join(', ')}.`
			: 'Send no argument: the tool takes none.',
	);
}

/** A variable error (graphql raises it before any field runs, so it has no path) gets a fix about the arguments. */
function withArgumentsFix(result: CallToolResult): CallToolResult {
	const body = result.structuredContent as JsonResult | undefined;
	const wrong = (error: Record<string, unknown>) =>
		error['path'] === undefined &&
		(error['extensions'] as { code?: unknown } | undefined)?.code ===
			'BAD_USER_INPUT';
	if (!body?.errors?.some(wrong)) return result;
	return resultOf({
		...body,
		errors: body.errors.map((error) =>
			wrong(error)
				? {
						...error,
						extensions: {
							...(error['extensions'] as object),
							fix: ARGUMENTS_FIX,
						},
					}
				: error,
		),
	});
}

/** Registers the typed tools one caller may use on its per-request server. */
export function registerOperationTools(
	server: McpServer,
	tools: readonly OperationTool[],
	context: ExecuteContext,
): void {
	for (const tool of tools)
		server.registerTool(
			tool.name,
			{
				title: tool.title,
				description: tool.description,
				inputSchema: advertised(tool.inputSchema),
				outputSchema: advertised(tool.outputSchema),
				annotations:
					tool.kind === 'query'
						? { readOnlyHint: true }
						: { readOnlyHint: false, destructiveHint: true },
			},
			(variables = {}) =>
				guarded(
					context,
					async () =>
						unknownArguments(tool, variables) ??
						withArgumentsFix(
							await execute(context, {
								document: tool.source,
								operationName: tool.title,
								variables,
							}),
						),
				),
		);
}

/**
 * The caller's view failed to build (`can` threw), so what the caller may
 * use is unknown: a call to a typed tool answers the retry-later error of
 * the other tools, not tool-not-found. For a request that does not list tools.
 */
export function registerFailedTools(
	server: McpServer,
	tools: readonly OperationTool[],
): void {
	for (const tool of tools)
		server.registerTool(
			tool.name,
			{ inputSchema: advertised({ type: 'object' }) },
			async () => failed(),
		);
}
