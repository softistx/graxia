import type { GraphQLSchema } from 'graphql';
import type { DocumentCaches, DocumentLimits } from '../document/types';
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
	 * `execute` threw). The response stays a generic 500. Default:
	 * `console.error`, silent when `NODE_ENV=production`; `false` silences it.
	 */
	onUnexpected?: OnUnexpected | false;
}

/** @internal Options with defaults applied. */
export interface ResolvedOptions {
	path: string | false;
	bodyBytes: number;
	batching: BatchingOption;
}
