import type {
	McpServer,
	StandardSchemaWithJSON,
} from '@modelcontextprotocol/server';
import { type ExecuteContext, execute } from '../tools/execute';
import { guarded } from '../tools/guard';
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
			(variables) =>
				guarded(context, () =>
					execute(context, {
						document: tool.source,
						operationName: tool.title,
						variables,
					}),
				),
		);
}
