/**
 * The error codes `exposedError` accepts. Add your own by augmenting it:
 *
 * ```ts
 * declare module '@graxia/core' {
 *   interface GraxiaErrorCodes {
 *     PAYMENT_REQUIRED: true;
 *   }
 * }
 * ```
 */
export interface GraxiaErrorCodes {
	/** The client sent a value the operation cannot use. */
	BAD_USER_INPUT: true;
	/** The caller is not signed in. */
	UNAUTHENTICATED: true;
	/** The caller is signed in but not allowed. */
	FORBIDDEN: true;
	/** The record asked for does not exist. */
	NOT_FOUND: true;
	/** The change conflicts with the current state. */
	CONFLICT: true;
	/** An unexpected failure (what masked errors carry). */
	INTERNAL_SERVER_ERROR: true;
	/** Emitted by core: the document does not parse. */
	GRAPHQL_PARSE_FAILED: true;
	/** Emitted by core: the document does not validate. */
	GRAPHQL_VALIDATION_FAILED: true;
	/** Emitted by core: the client left or the server shut down. */
	OPERATION_ABORTED: true;
	/** Emitted by core: a request a browser can send without a preflight carries no CSRF header (403). */
	CSRF_HEADER_REQUIRED: true;
	/** Emitted by core: a request or WebSocket upgrade from a refused origin (403). */
	FORBIDDEN_ORIGIN: true;
	/** Emitted by core: a persisted document or an automatic persisted query is not in the manifest or store. */
	PERSISTED_QUERY_NOT_FOUND: true;
	/** Emitted by core: a client sent a persisted query hash the server cannot serve (`apq` off, or `strict` mode). */
	PERSISTED_QUERY_NOT_SUPPORTED: true;
	/** Emitted by core: the persisted query extension has a `version` other than 1. */
	PERSISTED_QUERY_VERSION_NOT_SUPPORTED: true;
	/** Emitted by core: the `sha256Hash` of a persisted query is not the hash of the query sent with it. */
	PROVIDED_SHA_DOESNT_MATCH: true;
	/** Emitted by core: `strict` trusted documents refuse a query that is not persisted. */
	PERSISTED_QUERY_ONLY: true;
	/** Emitted by `fieldRateLimit`: a field's rate limit is spent (429, `Retry-After`; the code can be changed with `code`). */
	RATE_LIMITED: true;
	/** Emitted by `fieldRateLimit`: a `single` field is selected more than once in the operation (400). */
	FIELD_SELECTED_ONCE: true;
	/** Emitted by core: `dispose()` started. */
	SHUTTING_DOWN: true;
	/** Emitted by core: subscriptions over plain HTTP. */
	SUBSCRIPTION_NOT_SUPPORTED: true;
	/** Emitted by core: `@defer` / `@stream` over plain HTTP. */
	INCREMENTAL_NOT_SUPPORTED: true;
}

/** A code of {@link GraxiaErrorCodes}. */
export type GraxiaErrorCode = keyof GraxiaErrorCodes;
