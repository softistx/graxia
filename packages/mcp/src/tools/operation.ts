import {
	type DocumentNode,
	FieldsOnCorrectTypeRule,
	Kind,
	KnownArgumentNamesRule,
	KnownTypeNamesRule,
	NoSchemaIntrospectionCustomRule,
	type OperationDefinitionNode,
	PossibleFragmentSpreadsRule,
	parse,
	visit,
} from 'graphql';

export type Allowed = 'query' | 'mutation';

/** A reason the document may not run here, as the message, code and fix an agent reads. */
export interface Refusal {
	message: string;
	code: string;
	fix: string;
}

/**
 * The validation rules MCP applies to the caller's view: only the ones that
 * decide what the caller may see. Limits, cost and the rest of validation are
 * graxia's, when the operation runs.
 */
export const VIEW_RULES = [
	FieldsOnCorrectTypeRule,
	KnownTypeNamesRule,
	KnownArgumentNamesRule,
	PossibleFragmentSpreadsRule,
	NoSchemaIntrospectionCustomRule,
] as const;

/** The fix of an introspection refusal: the view is read through `graphql_schema`. */
export const INTROSPECTION_FIX = 'Use graphql_schema to read the schema.';

/**
 * Parses `query` under graxia's token limit. A document that does not parse
 * is refused here (fail closed): `graxia.execute` is never reached, so a
 * lenient plugin parser cannot run what the MCP checks have not seen.
 */
export function parseOperation(
	query: string,
	tokens: number | false,
): { document: DocumentNode } | { refusal: Refusal } {
	try {
		return {
			document: parse(query, tokens === false ? {} : { maxTokens: tokens }),
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const overflow = /more than \d+ tokens/.test(message);
		return {
			refusal: {
				message,
				code: 'GRAPHQL_PARSE_FAILED',
				fix: overflow
					? 'Split the operation or raise limits.tokens.'
					: 'Correct the syntax of the document at the position the error points to.',
			},
		};
	}
}

const wrongKind = (
	allowed: Allowed,
	found: string,
	writeScope?: string,
): Refusal => {
	if (found === 'subscription')
		return {
			message: 'Subscriptions are not available over MCP.',
			code: 'SUBSCRIPTION_NOT_SUPPORTED',
			fix: 'Send a query (graphql_query), or poll the same query again.',
		};
	return {
		message: `A ${found} cannot run in graphql_${allowed === 'query' ? 'query' : 'mutate'}.`,
		code: 'MCP_OPERATION_NOT_ALLOWED',
		fix:
			found === 'mutation'
				? `Use graphql_mutate for mutations (it is listed only when the server enables mutations${writeScope ? ` and the token has the scope ${writeScope}` : ''}).`
				: 'Use graphql_query for queries.',
	};
};

/** The operation `operationName` picks, or the only one; `undefined` when the choice is ambiguous (graxia then refuses). */
function selected(
	document: DocumentNode,
	operationName: string | undefined,
): OperationDefinitionNode | undefined {
	const operations = document.definitions.filter(
		(definition): definition is OperationDefinitionNode =>
			definition.kind === Kind.OPERATION_DEFINITION,
	);
	if (operationName)
		return operations.find((o) => o.name?.value === operationName);
	return operations.length === 1 ? operations[0] : undefined;
}

/**
 * Refuses what MCP does not run: the selected operation when it is another
 * kind than the tool's, and `@defer` / `@stream` (the result is one JSON value).
 * `writeScope` is the scope `graphql_mutate` needs when `auth` is on, for the fix.
 */
export function checkOperations(
	document: DocumentNode,
	allowed: Allowed,
	operationName?: string,
	writeScope?: string,
): Refusal | undefined {
	const operation = selected(document, operationName);
	if (operation && operation.operation !== allowed)
		return wrongKind(allowed, operation.operation, writeScope);
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
			code: 'INCREMENTAL_NOT_SUPPORTED',
			fix: `Remove @${incremental}: the tool returns one complete JSON result.`,
		};
	return undefined;
}
