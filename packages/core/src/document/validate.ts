import {
	type DocumentNode,
	GraphQLError,
	type GraphQLSchema,
	specifiedRules,
	type ValidationRule,
	validate,
} from 'graphql';
import { VALIDATION_FIX, withFix } from '../errors/fixes';
import type { ValidationFn } from '../plugins/types';
import type { ValidationCache } from './caches';
import { VALIDATION_FAILED } from './types';

/** What {@link checkDocument} needs from the pipeline. */
export interface ValidationCtx {
	schema: GraphQLSchema;
	/** Rules added to graphql's (the operation limits). */
	rules: readonly ValidationRule[];
	/** Omits "Did you mean ..." hints (the default validation only). */
	hideSuggestions: boolean;
	validationCache: ValidationCache | undefined;
}

/** @internal Lets a caller learn whether the cache served a step (for tracing). */
export interface CacheTrace {
	hit?: boolean;
}

/**
 * Validates `document`. The cache is used only for the default validation
 * (no plugin function or rules) of a document that has a `cacheKey`.
 */
export function checkDocument(
	ctx: ValidationCtx,
	document: DocumentNode,
	cacheKey: string | undefined,
	validationFn: ValidationFn | undefined,
	rules: readonly ValidationRule[],
	trace?: CacheTrace,
): readonly GraphQLError[] {
	const { schema, validationCache } = ctx;
	const key =
		validationCache &&
		cacheKey !== undefined &&
		!validationFn &&
		rules.length === 0
			? cacheKey
			: undefined;
	if (key !== undefined) {
		const hit = validationCache?.get(schema, key);
		if (trace) trace.hit = hit !== undefined;
		if (hit) return hit;
	}
	const all = [...specifiedRules, ...ctx.rules, ...rules];
	const found = validationFn
		? validationFn(schema, document, all)
		: validate(schema, document, all, { hideSuggestions: ctx.hideSuggestions });
	const coded = withCode(found);
	if (key !== undefined) validationCache?.set(schema, key, coded);
	return coded;
}

/** Stamps `extensions.code: GRAPHQL_VALIDATION_FAILED` on the errors that carry no code. */
function withCode(errors: readonly GraphQLError[]): readonly GraphQLError[] {
	return errors.map((error) =>
		withFix(
			error.extensions['code'] !== undefined
				? error
				: new GraphQLError(error.message, {
						nodes: error.nodes,
						source: error.source,
						positions: error.positions,
						path: error.path,
						originalError: error.originalError ?? error,
						extensions: { ...error.extensions, code: VALIDATION_FAILED },
					}),
			VALIDATION_FIX,
		),
	);
}
