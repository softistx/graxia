import { type DocumentNode, GraphQLError, Kind, parse } from 'graphql';
import { GraxiaConfigError } from '../errors/config-error';

/** SDL source: a string, a parsed document, or an array of both. */
export type TypeDefs =
	| string
	| DocumentNode
	| readonly (string | DocumentNode)[];

/** Parses and concatenates every entry into one document. Invalid SDL throws a `GraxiaConfigError` with the `GraphQLError` as `cause`. */
export function toDocument(typeDefs: TypeDefs): DocumentNode {
	const entries = Array.isArray(typeDefs) ? typeDefs : [typeDefs];
	const definitions = entries.flatMap((entry) => {
		if (typeof entry !== 'string') return entry.definitions;
		try {
			return parse(entry, { noLocation: true }).definitions;
		} catch (cause) {
			if (cause instanceof GraphQLError) throw sdlError(cause);
			throw cause;
		}
	});
	return { kind: Kind.DOCUMENT, definitions };
}

/** Wraps a graphql SDL failure. */
export function sdlError(cause: unknown): GraxiaConfigError {
	const message = cause instanceof Error ? cause.message : String(cause);
	return new GraxiaConfigError(`Invalid type definitions: ${message}`, {
		cause,
	});
}
