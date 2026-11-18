import { GraphQLError } from 'graphql';
import type { GraxiaErrorCode } from './codes';

/** Options of {@link exposedError}. */
export interface ExposedErrorOptions {
	/** More entries of `extensions` (`code` and `fix` win over the same names). */
	extensions?: Record<string, unknown>;
	/** A short sentence telling the client how to fix the error. */
	fix?: string;
}

/**
 * A `GraphQLError` the client may see as is. Anything else a resolver throws
 * is masked. Create it with {@link exposedError}.
 */
export class GraxiaError extends GraphQLError {
	/** The error code, also in `extensions.code`. */
	readonly code: GraxiaErrorCode;

	constructor(
		code: GraxiaErrorCode,
		message: string,
		options: ExposedErrorOptions = {},
	) {
		super(message, {
			extensions: {
				...options.extensions,
				code,
				...(options.fix !== undefined ? { fix: options.fix } : {}),
			},
		});
		this.name = 'GraxiaError';
		this.code = code;
	}
}

/**
 * Makes an error the client is meant to read: `message`, `extensions.code`
 * and optionally `extensions.fix` reach the response.
 *
 * @example
 * throw exposedError('NOT_FOUND', 'Book not found.', { fix: 'Check the id.' });
 */
export function exposedError(
	code: GraxiaErrorCode,
	message: string,
	options?: ExposedErrorOptions,
): GraxiaError {
	return new GraxiaError(code, message, options);
}

/** Whether a value is an error made by {@link exposedError}. */
export function isGraxiaError(value: unknown): value is GraxiaError {
	return value instanceof GraxiaError;
}
