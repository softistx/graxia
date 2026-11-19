import type { CallToolResult } from '@modelcontextprotocol/server';

/** A GraphQL-shaped result, as plain JSON. */
export interface JsonResult {
	data?: unknown;
	errors?: readonly Record<string, unknown>[];
}

/** A tool result carrying a GraphQL result: `structuredContent` and its JSON as text; an error when there is no `data`. */
export function resultOf(result: JsonResult): CallToolResult {
	return {
		content: [{ type: 'text', text: JSON.stringify(result) }],
		structuredContent: result as Record<string, unknown>,
		...(result.data == null ? { isError: true } : {}),
	};
}

/** A refused call, shaped like a GraphQL error (`extensions.code` and `extensions.fix`) so agents read it the same way. */
export function refused(
	message: string,
	code: string,
	fix: string,
): CallToolResult {
	return resultOf({ errors: [{ message, extensions: { code, fix } }] });
}

/** A plain text answer (the schema tool). */
export const textResult = (text: string, isError = false): CallToolResult => ({
	content: [{ type: 'text', text }],
	...(isError ? { isError: true } : {}),
});
