import type { DocumentNode, GraphQLError, GraphQLSchema } from 'graphql';
import { createLruCache, type LruCache } from './lru';
import type { DocumentCacheOptions } from './types';

/** A parse outcome as cached: the document, or the failure. */
export type ParseResult =
	| { document: DocumentNode }
	| { errors: readonly GraphQLError[] };

const DEFAULTS = {
	maxBytes: 64 * 1024 * 1024,
	max: 1024,
	ttlMs: 60 * 60 * 1000,
};

/**
 * Weight of a cached source: UTF-16 length x 2, the bytes of the key. It is
 * an estimate, not a heap measure: a parsed document costs several times
 * its source, so `maxBytes` bounds the sources and the real heap is a
 * multiple of it.
 */
export const sourceWeight = (source: string): number => source.length * 2;

/**
 * Creates the parse cache: source string to {@link ParseResult}. Failures are
 * cached too, so a bad document is not lexed again. A source heavier than
 * `maxBytes / 8` is never cached.
 */
export function createDocumentCache(
	options: DocumentCacheOptions = {},
): LruCache<string, ParseResult> {
	return createLruCache({
		max: options.max ?? DEFAULTS.max,
		maxWeight: options.maxBytes ?? DEFAULTS.maxBytes,
		ttlMs: options.ttlMs ?? DEFAULTS.ttlMs,
		weigh: (source) => sourceWeight(source),
		...(options.now ? { now: options.now } : {}),
	});
}

/**
 * Validation results, one LRU per schema (a `WeakMap`, so a dropped schema
 * frees its cache), keyed by the document's source string.
 */
export interface ValidationCache {
	get(
		schema: GraphQLSchema,
		source: string,
	): readonly GraphQLError[] | undefined;
	set(
		schema: GraphQLSchema,
		source: string,
		errors: readonly GraphQLError[],
	): void;
}

/** Creates the {@link ValidationCache}. */
export function createValidationCache(
	options: DocumentCacheOptions = {},
): ValidationCache {
	const perSchema = new WeakMap<
		GraphQLSchema,
		LruCache<string, readonly GraphQLError[]>
	>();
	const forSchema = (schema: GraphQLSchema) => {
		let cache = perSchema.get(schema);
		if (!cache) {
			cache = createLruCache({
				max: options.max ?? DEFAULTS.max,
				maxWeight: options.maxBytes ?? DEFAULTS.maxBytes,
				ttlMs: options.ttlMs ?? DEFAULTS.ttlMs,
				weigh: (source) => sourceWeight(source),
				...(options.now ? { now: options.now } : {}),
			});
			perSchema.set(schema, cache);
		}
		return cache;
	};
	return {
		get: (schema, source) => perSchema.get(schema)?.get(source),
		set: (schema, source, errors) => forSchema(schema).set(source, errors),
	};
}
