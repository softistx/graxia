/** Limits applied to a document before it is parsed. `false` turns one off. */
export interface DocumentLimits {
	/** The most tokens a document may hold. 15 000 by default. */
	tokens?: number | false;
	/** The most levels of `{`, `(` and `[` a document may nest. 1 000 by default. */
	nesting?: number | false;
}

/** Sizes of one cache. */
export interface DocumentCacheOptions {
	/** The most estimated bytes kept (UTF-16 length x 2 of the sources). 64 MiB by default. */
	maxBytes?: number;
	/** The most entries kept. 1 024 by default. */
	max?: number;
	/** How long an entry lives, in milliseconds. One hour by default. */
	ttlMs?: number;
	/** The clock in milliseconds; for tests. `Date.now` by default. */
	now?: () => number;
}

/** The `caches` option: sizes of each cache, or `false` to disable both. */
export type DocumentCaches =
	| false
	| {
			parse?: DocumentCacheOptions | false;
			validation?: DocumentCacheOptions | false;
	  };

/** Machine-readable code of a parse failure (Apollo and Yoga compatible). */
export const PARSE_FAILED = 'GRAPHQL_PARSE_FAILED';

/** Default {@link DocumentLimits.tokens}. */
export const DEFAULT_MAX_TOKENS = 15_000;
/** Default {@link DocumentLimits.nesting}. */
export const DEFAULT_MAX_NESTING = 1_000;
