import {
	type ExecutionResult,
	GraphQLError,
	type GraphQLSchema,
	isInterfaceType,
	isNonNullType,
	isObjectType,
} from 'graphql';
import { GraxiaError } from './exposed';
import { GRAPHQL_FIX, INTERNAL_FIX, withFix } from './fixes';

/** The message a masked error carries. */
export const UNEXPECTED_MESSAGE = 'Unexpected error.';

/** What a custom masker receives besides the error. */
export interface MaskInfo {
	/** The request id, also the `x-request-id` header. */
	correlationId: string | undefined;
}

/**
 * Replaces the error of an unexpected failure with what the client sees.
 *
 * It is called only for errors that are masked: those whose original is
 * neither a `GraphQLError` (a `GraxiaError` is one) nor absent, other than
 * graphql's own non-null violation. A plain `Error`, a thrown string or a
 * library error is masked; every `GraphQLError`, whoever made it, is exposed
 * as is. If it throws, the default masker is used instead.
 */
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
			fix: INTERNAL_FIX,
			...(correlationId !== undefined ? { correlationId } : {}),
		},
	});

// graphql-js words its own non-null violation as a plain `Error`. Re-check the
// wording in graphql's `Executor.js` on each graphql 17.x bump.
const NON_NULL = /^Cannot return null for non-nullable field (\w+)\.(\w+)\.$/;

/** Whether graphql itself raised this non-null violation (not a resolver forging its text). */
function isNonNullViolation(
	error: GraphQLError,
	cause: Error,
	schema: GraphQLSchema,
): boolean {
	const match = NON_NULL.exec(error.message);
	if (
		!match ||
		cause.constructor !== Error ||
		cause.message !== error.message ||
		!error.path?.length
	)
		return false;
	const type = schema.getType(match[1] as string);
	if (!isObjectType(type) && !isInterfaceType(type)) return false;
	const field = type.getFields()[match[2] as string];
	return field !== undefined && isNonNullType(field.type);
}

/**
 * Whether the error may reach the client. Exposed: graphql's own errors (no
 * `originalError`, and a genuine non-null violation, which graphql wraps in
 * a plain `Error`), a {@link GraxiaError}, and any `GraphQLError` a resolver
 * threw. Masked: everything else (a plain `Error`, a thrown string, a
 * library error).
 */
export function isExposed(error: GraphQLError, schema: GraphQLSchema): boolean {
	const cause = error.originalError;
	return (
		cause === undefined ||
		cause instanceof GraxiaError ||
		cause instanceof GraphQLError ||
		isNonNullViolation(error, cause, schema)
	);
}

/**
 * An exposed error whose `extensions` it merely inherited, by reference, from
 * a non-GraphQLError cause (graphql copies them) is rebuilt with none.
 */
function expose(error: GraphQLError): GraphQLError {
	const cause = error.originalError;
	if (
		cause === undefined ||
		cause instanceof GraphQLError ||
		(cause as { extensions?: unknown }).extensions === undefined ||
		error.extensions !== (cause as { extensions?: unknown }).extensions
	)
		return error;
	return new GraphQLError(error.message, {
		nodes: error.nodes,
		source: error.source,
		positions: error.positions,
		path: error.path,
		extensions: {},
	});
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
	schema: GraphQLSchema,
): Masked {
	const unexpected: unknown[] = [];
	if (!result.errors) return { result, unexpected };
	let changed = false;
	// No `data` key: execution never started (variables, operation selection), so graphql wrote the errors.
	const beforeExecution = !('data' in result);
	const errors = result.errors.map((error) => {
		if (isExposed(error, schema)) {
			// An error graphql raised itself (variables, operation selection, non-null) has no fix yet.
			const cause = error.originalError;
			const own =
				beforeExecution ||
				cause === undefined ||
				!(cause instanceof GraphQLError);
			const exposed = expose(error);
			const out = own ? withFix(exposed, GRAPHQL_FIX) : exposed;
			changed ||= out !== error;
			return out;
		}
		changed = true;
		unexpected.push(error.originalError ?? error);
		try {
			return mask(error, info);
		} catch (maskerError) {
			unexpected.push(maskerError);
			return defaultMask(error, info);
		}
	});
	return changed
		? { result: { ...result, errors }, unexpected }
		: { result, unexpected };
}
