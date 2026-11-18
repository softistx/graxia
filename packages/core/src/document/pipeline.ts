import {
	type DocumentNode,
	type GraphQLError,
	type GraphQLSchema,
	specifiedRules,
	type ValidationRule,
	validate,
} from 'graphql';
import type { PluginEngine } from '../plugins/engine';
import type { RequestState } from '../plugins/state';
import type { ParseFn, ValidationFn } from '../plugins/types';
import {
	createDocumentCache,
	createValidationCache,
	type ParseResult,
} from './caches';
import { parseWithLimits, resolveLimits } from './parse';
import type { DocumentCaches, DocumentLimits } from './types';

/** Options of {@link createDocumentPipeline}. */
export interface DocumentPipelineOptions {
	/** The schema documents are validated against. */
	schema: GraphQLSchema;
	/** The plugin engine whose `onParse` / `onValidate` runners are driven. */
	engine: PluginEngine;
	/** Parse limits. */
	limits?: DocumentLimits;
	/** Cache sizes, or `false` to disable both caches. */
	caches?: DocumentCaches;
}

/** Outcome of a pipeline step. `error` is a value thrown by a plugin hook, unmasked. */
export interface StepResult {
	/** The document, set when the step succeeded. */
	document?: DocumentNode;
	/** The failures (parse failure or validation errors), set when it did not. */
	errors?: readonly GraphQLError[];
	/** A value thrown by a plugin hook, never masked here. */
	error?: unknown;
}

/** The parse and validation steps of a request. */
export interface DocumentPipeline {
	/** Runs `onParse`, then the limited and cached parse. */
	parse(input: {
		source: string;
		state: RequestState;
		request: Request;
	}): Promise<StepResult>;
	/**
	 * Runs `onValidate`, then the cached validation. `source` is the document's
	 * source string; without it (a document a plugin built) nothing is cached.
	 */
	validate(input: {
		document: DocumentNode;
		source?: string;
		state: RequestState;
		request: Request;
	}): Promise<StepResult>;
}

/**
 * Creates the document pipeline. A plugin-set parse function bypasses the
 * parse cache (its output is not a function of the source alone), though the
 * limits still apply. The validation cache is skipped when a plugin adds
 * rules or swaps the validation function: the key would have to identify
 * them, and skipping is the safe choice.
 */
export function createDocumentPipeline(
	options: DocumentPipelineOptions,
): DocumentPipeline {
	const { schema, engine } = options;
	const limits = resolveLimits(options.limits);
	const caches = options.caches === false ? {} : (options.caches ?? {});
	const parseCache =
		options.caches === false || caches.parse === false
			? undefined
			: createDocumentCache(caches.parse);
	const validationCache =
		options.caches === false || caches.validation === false
			? undefined
			: createValidationCache(caches.validation);

	return {
		async parse({ source, state, request }) {
			const params = { query: source };
			const outcome = await engine.runners.onParse({ request, state, params });
			const { out, error } = outcome;
			let result: ParseResult;
			if (error !== undefined) result = { errors: [] };
			else if (out.document) result = { document: out.document };
			else result = parseSource(source, out.parseFn);
			const afterError = await finish(outcome.runAfter, {
				document: 'document' in result ? result.document : undefined,
			});
			const failure = error ?? afterError;
			return {
				...result,
				...(failure !== undefined ? { error: failure } : {}),
			};
		},
		async validate({ document, source, state, request }) {
			const outcome = await engine.runners.onValidate({
				request,
				state,
				schema,
				document,
			});
			const { out, error } = outcome;
			let errors: readonly GraphQLError[];
			if (error !== undefined) errors = [];
			else if (out.errors) errors = out.errors;
			else errors = check(out.validationFn, out.rules);
			const afterError = await finish(outcome.runAfter, {
				errors: error === undefined ? errors : undefined,
			});
			const failure = error ?? afterError;
			return {
				...(errors.length > 0 || failure !== undefined
					? { errors }
					: { document }),
				...(failure !== undefined ? { error: failure } : {}),
			} as StepResult;

			function check(
				validationFn: ValidationFn | undefined,
				rules: readonly ValidationRule[],
			): readonly GraphQLError[] {
				const cacheable =
					validationCache &&
					source !== undefined &&
					!validationFn &&
					rules.length === 0;
				if (cacheable) {
					const hit = validationCache.get(schema, source);
					if (hit) return hit;
				}
				const found = (validationFn ?? validate)(schema, document, [
					...specifiedRules,
					...rules,
				]);
				if (cacheable) validationCache.set(schema, source, found);
				return found;
			}
		},
	};

	function parseSource(
		source: string,
		parseFn: ParseFn | undefined,
	): ParseResult {
		if (parseFn || !parseCache) return parseWithLimits(source, limits, parseFn);
		const hit = parseCache.get(source);
		if (hit) return hit;
		const result = parseWithLimits(source, limits);
		parseCache.set(source, result);
		return result;
	}
}

async function finish<D>(
	runAfter: (done: D) => Promise<void>,
	done: D,
): Promise<unknown> {
	try {
		await runAfter(done);
		return undefined;
	} catch (error) {
		return error;
	}
}
