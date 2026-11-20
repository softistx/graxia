import type {
	DocumentNode,
	GraphQLError,
	GraphQLSchema,
	ValidationRule,
} from 'graphql';
import type { PluginEngine } from '../plugins/engine';
import { NO_AFTER } from '../plugins/stage';
import type { RequestState } from '../plugins/state';
import {
	createDocumentCache,
	createValidationCache,
	type ParseResult,
	type ValidationCache,
} from './caches';
import type { LruCache } from './lru';
import {
	isOverflow,
	parseWithLimits,
	type ResolvedLimits,
	resolveLimits,
} from './parse';
import type { DocumentCaches, DocumentLimits } from './types';
import { type CacheTrace, checkDocument } from './validate';

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
	/** Validation rules added to graphql's (the operation limits). */
	rules?: readonly ValidationRule[];
	/** Omits "Did you mean ..." hints from validation errors (not for a plugin's own validation function). */
	hideSuggestions?: boolean;
}

/** Outcome of a pipeline step. `error` is a value thrown by a plugin hook, unmasked. */
export interface StepResult {
	/** The document, set when the step succeeded. */
	document?: DocumentNode;
	/** The failures (parse failure or validation errors), set when it did not. */
	errors?: readonly GraphQLError[];
	/** A value thrown by a plugin hook, never masked here. */
	error?: unknown;
	/** Whether a cache served the step (the default parse or validation of a cached source). Absent when no cache was consulted. */
	cacheHit?: boolean;
	/**
	 * Set by `parse` only when the document is the default parse of the source
	 * (no `setParseFn`, no `setDocument`). Pass it to `validate` as `cacheKey`.
	 */
	cacheKey?: string;
}

/** The parse and validation steps of a request. */
export interface DocumentPipeline {
	/** Runs `onParse`, then the limited and cached parse. */
	parse(input: {
		source: string;
		state: RequestState;
		request: Request;
		serverContext: Readonly<Record<string, unknown>>;
		/** A document already parsed (`graxia.execute`): used instead of parsing `source`, after `onParse` ran. */
		document?: DocumentNode | undefined;
	}): Promise<StepResult>;
	/**
	 * Runs `onValidate`, then the validation. The validation cache is used only
	 * when `cacheKey` is given: pass the `cacheKey` that `parse` returned, never
	 * the source yourself. A document a plugin supplied or parsed differently
	 * has no `cacheKey` and is neither read from nor written to the cache.
	 */
	validate(input: {
		document: DocumentNode;
		cacheKey?: string | undefined;
		state: RequestState;
		request: Request;
		serverContext: Readonly<Record<string, unknown>>;
	}): Promise<StepResult>;
}

interface Ctx {
	schema: GraphQLSchema;
	engine: PluginEngine;
	limits: ResolvedLimits;
	rules: readonly ValidationRule[];
	hideSuggestions: boolean;
	parseCache: LruCache<string, ParseResult> | undefined;
	validationCache: ValidationCache | undefined;
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
	const caches = options.caches === false ? {} : (options.caches ?? {});
	const off = options.caches === false;
	const ctx: Ctx = {
		schema: options.schema,
		engine: options.engine,
		limits: resolveLimits(options.limits),
		rules: options.rules ?? [],
		hideSuggestions: options.hideSuggestions ?? false,
		parseCache:
			off || caches.parse === false
				? undefined
				: createDocumentCache(caches.parse),
		validationCache:
			off || caches.validation === false
				? undefined
				: createValidationCache(caches.validation),
	};
	return {
		parse: (input) => runParse(ctx, input),
		validate: (input) => runValidate(ctx, input),
	};
}

async function runParse(
	ctx: Ctx,
	input: {
		source: string;
		state: RequestState;
		request: Request;
		serverContext: Readonly<Record<string, unknown>>;
		document?: DocumentNode | undefined;
	},
): Promise<StepResult> {
	const { source, state, request, serverContext } = input;
	const outcome = await ctx.engine.runners.onParse({
		request,
		state,
		serverContext,
		params: { query: source },
	});
	const { out, error } = outcome;
	let result: ParseResult;
	let cacheKey: string | undefined;
	const trace: CacheTrace = {};
	if (error !== undefined) result = { errors: [] };
	else if (out.document) result = { document: out.document };
	else if (input.document) result = { document: input.document };
	else if (out.parseFn)
		result = parseWithLimits(source, ctx.limits, out.parseFn);
	else {
		result = parseDefault(ctx, source, trace);
		if ('document' in result) cacheKey = source;
	}
	const afterError = await finish(outcome.runAfter, {
		document: 'document' in result ? result.document : undefined,
	});
	const failure = error ?? afterError;
	return {
		...result,
		...(cacheKey !== undefined ? { cacheKey } : {}),
		...(trace.hit !== undefined ? { cacheHit: trace.hit } : {}),
		...(failure !== undefined ? { error: failure } : {}),
	};
}

/** Default parse through the cache; stack-overflow failures are not cached. */
function parseDefault(
	ctx: Ctx,
	source: string,
	trace: CacheTrace,
): ParseResult {
	const { parseCache } = ctx;
	if (!parseCache) return parseWithLimits(source, ctx.limits);
	const hit = parseCache.get(source);
	trace.hit = hit !== undefined;
	if (hit) return hit;
	const result = parseWithLimits(source, ctx.limits);
	const overflow = 'errors' in result && result.errors.some(isOverflow);
	if (!overflow) parseCache.set(source, result);
	return result;
}

async function runValidate(
	ctx: Ctx,
	input: {
		document: DocumentNode;
		cacheKey?: string | undefined;
		state: RequestState;
		request: Request;
		serverContext: Readonly<Record<string, unknown>>;
	},
): Promise<StepResult> {
	const { document, cacheKey, state, request, serverContext } = input;
	const outcome = await ctx.engine.runners.onValidate({
		request,
		state,
		serverContext,
		schema: ctx.schema,
		document,
	});
	const { out, error } = outcome;
	let errors: readonly GraphQLError[] = [];
	let thrown: unknown;
	const trace: CacheTrace = {};
	if (error === undefined) {
		try {
			errors = out.errors
				? out.errors
				: checkDocument(
						ctx,
						document,
						cacheKey,
						out.validationFn,
						out.rules,
						trace,
					);
		} catch (caught) {
			// A throwing rule or validation function: the after-hooks still run.
			thrown = caught;
		}
	}
	const afterError = await finish(outcome.runAfter, {
		errors: error === undefined && thrown === undefined ? errors : undefined,
	});
	const failure = error ?? thrown ?? afterError;
	return {
		...(errors.length > 0 || failure !== undefined ? { errors } : { document }),
		...(trace.hit !== undefined ? { cacheHit: trace.hit } : {}),
		...(failure !== undefined ? { error: failure } : {}),
	};
}

function finish<D>(
	runAfter: (done: D) => Promise<void>,
	done: D,
): Promise<unknown> | undefined {
	return runAfter === NO_AFTER ? undefined : finishAfter(runAfter, done);
}

async function finishAfter<D>(
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
