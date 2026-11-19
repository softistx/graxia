import { type DocumentNode, GraphQLError, Kind, parse, visit } from 'graphql';

export type Allowed = 'query' | 'mutation';

/** A reason the document may not run here, as the message, code and fix an agent reads. */
export interface Refusal {
	message: string;
	code: string;
	fix: string;
}

/** Parses `query`; a syntax error is a refusal that quotes the position. */
export function parseOperation(query: string): DocumentNode | Refusal {
	try {
		return parse(query);
	} catch (error) {
		if (!(error instanceof GraphQLError)) throw error;
		return {
			message: error.message,
			code: 'GRAPHQL_PARSE_FAILED',
			fix: 'Correct the syntax of the document at the position the error points to.',
		};
	}
}

const wrongKind = (allowed: Allowed, found: string): Refusal => {
	if (found === 'subscription')
		return {
			message: 'Subscriptions are not available over MCP.',
			code: 'MCP_OPERATION_NOT_ALLOWED',
			fix: 'Send a query (graphql_query), or poll the same query again.',
		};
	return {
		message: `A ${found} cannot run in graphql_${allowed === 'query' ? 'query' : 'mutate'}.`,
		code: 'MCP_OPERATION_NOT_ALLOWED',
		fix:
			found === 'mutation'
				? 'Use graphql_mutate for mutations (it is listed only when the server enables mutations).'
				: 'Use graphql_query for queries.',
	};
};

/**
 * Refuses what MCP does not run: another kind of operation than the tool's,
 * and `@defer` / `@stream` (the result is one JSON value).
 */
export function checkOperations(
	document: DocumentNode,
	allowed: Allowed,
): Refusal | undefined {
	for (const definition of document.definitions)
		if (
			definition.kind === Kind.OPERATION_DEFINITION &&
			definition.operation !== allowed
		)
			return wrongKind(allowed, definition.operation);
	let incremental: string | undefined;
	visit(document, {
		Directive(node) {
			if (node.name.value === 'defer' || node.name.value === 'stream')
				incremental ??= node.name.value;
		},
	});
	if (incremental)
		return {
			message: `@${incremental} is not available over MCP.`,
			code: 'MCP_OPERATION_NOT_ALLOWED',
			fix: `Remove @${incremental}: the tool returns one complete JSON result.`,
		};
	return undefined;
}
