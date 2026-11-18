import { type ExecutionResult, GraphQLError } from 'graphql';
import { GraxiaError } from './exposed';

/** The message a masked error carries. */
export const UNEXPECTED_MESSAGE = 'Unexpected error.';

/** What a custom masker receives besides the error. */
export interface MaskInfo {
	/** The request id, also the `x-request-id` header. */
	correlationId: string | undefined;
}

/** Replaces the error of an unexpected failure with what the client sees. */
export type MaskError = (error: GraphQLError, info: MaskInfo) => GraphQLError;

/** The default masker: `Unexpected error.` plus `INTERNAL_SERVER_ERROR` and the correlation id. */
export const defaultMask: MaskError = (error, { correlationId }) =>
	new GraphQLError(UNEXPECTED_MESSAGE, {
		nodes: error.nodes,
		source: error.source,
		positions: error.positions,
		path: error.path,
		extensions: {
			code: 'INTERNAL_SERVER_ERROR',
			...(correlationId !== undefined ? { correlationId } : {}),
		},
	});

const NON_NULL = /^Cannot return null for non-nullable field \S+\.$/;

/**
 * Whether the error may reach the client as is: graphql's own errors (no
 * `originalError`, plus the non-null violation, which graphql wraps in a
 * plain `Error`), {@link GraxiaError}, and any `GraphQLError` a resolver
 * threw. Everything else is an unexpected failure.
 */
export function isExposed(error: GraphQLError): boolean {
	const cause = error.originalError;
	return (
		cause === undefined ||
		NON_NULL.test(error.message) ||
		cause instanceof GraxiaError ||
		cause instanceof GraphQLError
	);
}

/** The errors of a result with the unexpected ones replaced. */
export interface Masked {
	result: ExecutionResult;
	/** The original errors that were masked. */
	unexpected: unknown[];
}

/** Masks the unexpected errors of a result; the result is returned as is when none is. */
export function maskResult(
	result: ExecutionResult,
	mask: MaskError,
	info: MaskInfo,
): Masked {
	const unexpected: unknown[] = [];
	if (!result.errors) return { result, unexpected };
	const errors = result.errors.map((error) => {
		if (isExposed(error)) return error;
		unexpected.push(error.originalError ?? error);
		return mask(error, info);
	});
	return unexpected.length === 0
		? { result, unexpected }
		: { result: { ...result, errors }, unexpected };
}
