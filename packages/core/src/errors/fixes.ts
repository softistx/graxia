import { GraphQLError } from 'graphql';

/** The `fix` of an error that graphql itself raised (variables, operation selection, non-null). */
export const GRAPHQL_FIX =
	'Check the operation against the schema: its variables, the operation name and the selected fields.';

/** The `fix` of an unexpected failure the masker hides: nothing about the cause leaks. */
export const INTERNAL_FIX =
	'Retry later; quote the correlationId when you report it.';

/** The `fix` of a document that does not parse. */
export const PARSE_FIX =
	'Correct the syntax of the document at the position the error points to.';

/** The `fix` of a document the schema refuses. */
export const VALIDATION_FIX =
	'Change the operation so it matches the schema (see the message for the field, argument or type).';

/**
 * Returns `error` with `extensions.fix` set to `fix` when it has none, so
 * that every error graxia emits tells the client what to change.
 * An error that already has a `fix` is returned as is.
 */
export function withFix(error: GraphQLError, fix: string): GraphQLError {
	if (typeof error.extensions['fix'] === 'string') return error;
	return new GraphQLError(error.message, {
		nodes: error.nodes,
		source: error.source,
		positions: error.positions,
		path: error.path,
		...(error.originalError ? { originalError: error.originalError } : {}),
		extensions: { ...error.extensions, fix },
	});
}
