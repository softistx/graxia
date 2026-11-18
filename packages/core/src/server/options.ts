import type { GraphQLSchema } from 'graphql';
import type { DocumentCaches, DocumentLimits } from '../document/types';
import type { MaskError } from '../errors/mask';
import type { BatchingOption } from '../http/batch';
import type {
	GraphQLParams,
	GraxiaPlugin,
	MaybePromise,
} from '../plugins/types';
import type { OnUnexpected } from './unexpected';

/** What the `context` option receives for each operation. */
export interface ContextInit<HostCtx> {
	/** The incoming request. */
	request: Request;
	/** The host's context, as passed to `fetch(request, serverContext)`. */
	serverContext: HostCtx;
	/** The operation's parameters (after `onParams`). */
	params: GraphQLParams;
	/**
	 * Aborts when the client disconnects or the server shuts down past its
	 * timeout. Also in the context as `signal` and passed to `execute`.
	 */
	signal: AbortSignal;
}

/** `limits` option: document limits plus the request body limit. */
export interface GraxiaLimits extends DocumentLimits {
	/** The most bytes of a request body read. 1 MiB by default; more answers 413. */
	bodyBytes?: number;
}

/** Options of {@link createGraxia}. */
export interface GraxiaOptions<HostCtx extends object = Record<never, never>> {
	/** The schema to serve (a `SchemaWithContext<Ctx>` from `createSchema` is accepted). */
	schema: GraphQLSchema;
	/** Path served; `/graphql` by default. `false` serves any path (the host routes). */
	path?: string | false;
	/**
	 * Builds the context of each operation, merged over `serverContext`
	 * (`{ ...serverContext, ...returned }`), before `onContext` plugins run.
	 */
	context?: (init: ContextInit<HostCtx>) => MaybePromise<object>;
	/**
	 * Makes `getContext()` work (an `AsyncLocalStorage` around each operation's
	 * execution). `true` by default; `false` skips it and `getContext()` throws.
	 */
	asyncContext?: boolean;
	/** Milliseconds `dispose()` waits for in-flight operations before aborting them. 10 000 by default. */
	shutdownTimeout?: number;
	/** Plugins (see `definePlugin`). */
	plugins?: readonly GraxiaPlugin<any, any>[];
	/** Document and body limits. */
	limits?: GraxiaLimits;
	/** Parse and validation caches, or `false` to disable both. */
	caches?: DocumentCaches;
	/** Batched operations (a JSON array body): off by default, or `{ limit }`. */
	batching?: BatchingOption;
	/**
	 * Receives the original error of every unexpected failure (a hook or
	 * `execute` threw, a resolver threw a plain error). The response stays a
	 * generic 500 or a masked error. Default: `console.error`, silent when
	 * `NODE_ENV=production`; `false` silences it.
	 */
	onUnexpected?: OnUnexpected | false;
	/**
	 * Replaces the masker of unexpected resolver errors. Exposed (never
	 * masked): graphql's own errors, `exposedError`, any `GraphQLError` and a
	 * genuine non-null violation. Masked: everything else (a plain `Error`, a
	 * thrown string, a library error). If it throws, the default masker is used
	 * and its error is reported too. The default answers `Unexpected error.` with
	 * `INTERNAL_SERVER_ERROR` and the correlation id.
	 */
	maskError?: MaskError;
	/**
	 * `false` turns masking off: every resolver error reaches the client with
	 * its message. Unsafe, for tests only. `true` by default, in every environment.
	 */
	maskErrors?: boolean;
}

/** @internal Options with defaults applied. */
export interface ResolvedOptions {
	path: string | false;
	bodyBytes: number;
	batching: BatchingOption;
	asyncContext: boolean;
	shutdownTimeout: number;
}
