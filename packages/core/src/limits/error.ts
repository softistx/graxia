import { type ASTNode, GraphQLError } from 'graphql';
import { VALIDATION_FAILED } from '../document/types';

/** The refusal of an operation over a limit: a validation failure that says which limit. */
export function limitError(
	message: string,
	limit: { name: string; max: number; actual: number },
	fix: string,
	node?: ASTNode,
): GraphQLError {
	return new GraphQLError(message, {
		...(node ? { nodes: [node] } : {}),
		extensions: { code: VALIDATION_FAILED, limit, fix },
	});
}
