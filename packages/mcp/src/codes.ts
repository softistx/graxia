/** The error codes of `@graxia/mcp`; the rest of what an agent reads comes from `@graxia/core`. */
export const MCP_ERROR_CODES = [
	'MCP_OPERATION_NOT_ALLOWED',
	'MCP_EXECUTION_REFUSED',
] as const;

/** A code only `@graxia/mcp` emits. */
export type McpErrorCode = (typeof MCP_ERROR_CODES)[number];

declare module '@graxia/core' {
	interface GraxiaErrorCodes {
		/** Emitted by @graxia/mcp: the tool runs another kind of operation than the one sent (a mutation in `graphql_query`, a query in `graphql_mutate`). */
		MCP_OPERATION_NOT_ALLOWED: true;
		/** Emitted by @graxia/mcp: `graxia.execute` ended without a GraphQL result and its response carried no error to relay (a plugin's bare `respond`, a shutdown). */
		MCP_EXECUTION_REFUSED: true;
	}
}
