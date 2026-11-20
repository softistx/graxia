/** The tool name of an operation: its name in snake_case (`BookById` is `book_by_id`, `getHTTPStatus` is `get_http_status`). */
export function toolNameOf(operationName: string): string {
	return operationName
		.replace(/([a-z0-9])([A-Z])/g, '$1_$2')
		.replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
		.toLowerCase();
}

/** Tool names starting with this are the generic tools' (`graphql_schema`, `graphql_query`, `graphql_mutate`). */
export const RESERVED_PREFIX = 'graphql_';
