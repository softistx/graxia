import {
	type DocumentNode,
	GraphQLError,
	Lexer,
	parse,
	Source,
	TokenKind,
} from 'graphql';
import { PARSE_FIX } from '../errors/fixes';
import type { ParseFn } from '../plugins/types';
import { tooDeepAt } from './nesting';
import {
	DEFAULT_MAX_NESTING,
	DEFAULT_MAX_TOKENS,
	type DocumentLimits,
	PARSE_FAILED,
} from './types';

/** Limits with their defaults applied. */
export interface ResolvedLimits {
	readonly tokens: number | false;
	readonly nesting: number | false;
}

/** Applies the defaults of {@link DocumentLimits}. */
export function resolveLimits(limits: DocumentLimits = {}): ResolvedLimits {
	return {
		tokens: limits.tokens ?? DEFAULT_MAX_TOKENS,
		nesting: limits.nesting ?? DEFAULT_MAX_NESTING,
	};
}

const overflows = new WeakSet<GraphQLError>();

/** Whether the failure is a stack overflow (such a failure is not cached). */
export const isOverflow = (error: GraphQLError): boolean =>
	overflows.has(error);

/** A parse failure as the GraphQLError a client sees. */
export function parseFailure(
	message: string,
	extensions: Record<string, unknown> = {},
	cause?: unknown,
): GraphQLError {
	return new GraphQLError(message, {
		extensions: { code: PARSE_FAILED, fix: PARSE_FIX, ...extensions },
		...(cause === undefined ? {} : { originalError: asError(cause) }),
	});
}

const asError = (value: unknown): Error =>
	value instanceof Error ? value : new Error(String(value));

/** Counts the tokens of `source` with graphql's Lexer, stopping past `max`. */
function tokensExceed(source: string, max: number): boolean {
	const lexer = new Lexer(new Source(source));
	let count = 0;
	try {
		while (lexer.advance().kind !== TokenKind.EOF) {
			if (++count > max) return true;
		}
	} catch {
		// a lexing error is the parser's to report
	}
	return false;
}

const tooMany = (limit: number) =>
	parseFailure(
		`Document contains more than ${limit} tokens. Parsing aborted.`,
		{
			limit,
			fix: 'Split the operation or raise limits.tokens.',
		},
	);

/**
 * Parses `source` under `limits`, never throwing: a pre-scan refuses a
 * document nested past `limits.nesting`, tokens are bounded by graphql 17's
 * `parse(source, { maxTokens })` (or counted with the Lexer when a custom
 * `parseFn` is given), and a stack overflow (`RangeError`) is a parse
 * failure. Every failure is a `GRAPHQL_PARSE_FAILED` GraphQLError.
 */
export function parseWithLimits(
	source: string,
	limits: ResolvedLimits,
	parseFn?: ParseFn,
): { document: DocumentNode } | { errors: readonly GraphQLError[] } {
	if (limits.nesting !== false && tooDeepAt(source, limits.nesting) >= 0) {
		const limit = limits.nesting;
		return {
			errors: [
				parseFailure(
					`Document is nested more than ${limit} levels deep. Parsing aborted.`,
					{
						limit,
						fix: 'Flatten the operation or raise limits.nesting.',
					},
				),
			],
		};
	}
	if (
		parseFn &&
		limits.tokens !== false &&
		tokensExceed(source, limits.tokens)
	) {
		return { errors: [tooMany(limits.tokens)] };
	}
	try {
		const document = parseFn
			? parseFn(source)
			: parse(
					source,
					limits.tokens === false ? {} : { maxTokens: limits.tokens },
				);
		return { document };
	} catch (error) {
		if (error instanceof RangeError) {
			// No `originalError`: masking would turn it into "Unexpected error.".
			const failure = parseFailure('Document is nested too deeply to parse.', {
				fix: 'Flatten the operation.',
			});
			overflows.add(failure);
			return { errors: [failure] };
		}
		if (
			limits.tokens !== false &&
			/more than \d+ tokens/.test(String((error as Error)?.message))
		) {
			return { errors: [tooMany(limits.tokens)] };
		}
		// A GraphQLError a custom parse function raised with its own code (an
		// Envelop plugin, say) is the client's answer as written; graphql's
		// syntax errors carry no code and are labelled below.
		if (
			error instanceof GraphQLError &&
			typeof error.extensions['code'] === 'string'
		)
			return { errors: [error] };
		if (error instanceof GraphQLError) {
			return {
				errors: [
					new GraphQLError(error.message, {
						source: error.source,
						positions: error.positions,
						originalError: error,
						extensions: {
							fix: PARSE_FIX,
							...error.extensions,
							code: PARSE_FAILED,
						},
					}),
				],
			};
		}
		return { errors: [parseFailure(asError(error).message, {}, error)] };
	}
}
