/** The error codes of `@graxia/mcp`; the rest of what an agent reads comes from `@graxia/core`. */
export const MCP_ERROR_CODES = [
	'MCP_OPERATION_NOT_ALLOWED',
	'MCP_EXECUTION_REFUSED',
	'MCP_UNKNOWN_ARGUMENT',
	'MCP_UNAUTHORIZED',
	'MCP_INSUFFICIENT_SCOPE',
	'MCP_TOKEN_IN_URL',
] as const;

/** A code only `@graxia/mcp` emits. */
export type McpErrorCode = (typeof MCP_ERROR_CODES)[number];

declare module '@graxia/core' {
	interface GraxiaErrorCodes {
		/** Emitted by @graxia/mcp: the tool runs another kind of operation than the one sent (a mutation in `graphql_query`, a query in `graphql_mutate`). */
		MCP_OPERATION_NOT_ALLOWED: true;
		/** Emitted by @graxia/mcp: `graxia.execute` ended without a GraphQL result and its response carried no error to relay (a plugin's bare `respond`, a shutdown). */
		MCP_EXECUTION_REFUSED: true;
		/** Emitted by @graxia/mcp: a typed tool was called with an argument its input schema does not have. */
		MCP_UNKNOWN_ARGUMENT: true;
		/** Emitted by @graxia/mcp: a 401, the request has no valid bearer token (`auth` is set). */
		MCP_UNAUTHORIZED: true;
		/** Emitted by @graxia/mcp: a 403, the token lacks the read scope, or the write scope `graphql_mutate` and the typed tools of mutations need. */
		MCP_INSUFFICIENT_SCOPE: true;
		/** Emitted by @graxia/mcp: a 400, the access token was sent in the query string. */
		MCP_TOKEN_IN_URL: true;
	}
}
