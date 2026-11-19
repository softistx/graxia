import type { GraphQLSchema } from 'graphql';
import type { DocumentCaches, DocumentLimits } from '../document/types';
import type { MaskError } from '../errors/mask';
import type { BatchingOption } from '../http/batch';
import type {
	OperationLimits,
	ResolvedOperationLimits,
} from '../limits/options';
import type {
	GraphQLParams,
	GraxiaPlugin,
	MaybePromise,
} from '../plugins/types';
import type { CsrfOptions, ResolvedCsrf } from '../security/options';
import type { TelemetryOptions } from '../telemetry';
import type { TrustedDocumentsOptions } from '../trusted/types';
import type { ResolvedWebSocket, WebSocketOptions } from '../ws/options';
import type { OnUnexpected } from './unexpected';

/** What the `context` option receives for each operation. */
export interface ContextInit<HostCtx = Record<never, never>> {
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

/** `limits` option: document limits, operation limits and the request body limit. */
export interface GraxiaLimits extends DocumentLimits, OperationLimits {
	/** The most bytes of a request body read. 1 MiB by default; more answers 413. */
	bodyBytes?: number;
}

/** The `subscriptions` option of {@link createGraxia}. */
export interface SubscriptionsOptions {
	/**
	 * Serves a request whose `Accept` prefers `text/event-stream` as an event
	 * stream (subscriptions, and queries or mutations as one event). Enabled by
	 * default; `false` answers a subscription over HTTP with
	 * `SUBSCRIPTION_NOT_SUPPORTED`. `{ keepAliveMs }` sets the milliseconds
	 * between keep-alive comments on an open stream (12 000 by default; `0`
	 * turns them off; an integer up to 2_147_483_647).
	 */
	sse?: boolean | { keepAliveMs?: number };
	/**
	 * Serves subscriptions, queries and mutations over WebSocket
	 * (`graphql-transport-ws`) on the same path. Enabled by default; `false`
	 * leaves an upgrade request to the normal HTTP handling.
	 */
	ws?: boolean | WebSocketOptions;
}

/** The `incremental` option of {@link createGraxia}: `@defer` and `@stream` delivery. */
export interface IncrementalOptions {
	/**
	 * The wire format of the payloads. `graphql17` (default) is graphql 17's:
	 * `pending` / `incremental` / `completed` with ids, what the current
	 * incremental-delivery RFC and Apollo Client 4 read. `legacy` is the
	 * 2022-08 format (`path` and `label` on each payload) that older Apollo,
	 * urql and Relay clients read.
	 */
	format?: 'graphql17' | 'legacy';
}

/** What `Plugins` defaults to when `plugins` is not given: any list of plugins, marked so the context check knows none was passed. */
export type NoPlugins = readonly GraxiaPlugin<any, any>[] & {
	readonly '~none'?: true;
};

/** The `context` option: builds the context of each operation. */
export type ContextFactory<HostCtx = Record<never, never>> = (
	init: ContextInit<HostCtx>,
) => MaybePromise<object>;

/**
 * Options of {@link createGraxia}. Every type parameter is inferred from the
 * call: type the host on the `context` factory (`ContextInit<{ … }>`), never
 * with `createGraxia<…>`, which turns the schema's context check off.
 */
export interface GraxiaOptions<
	HostCtx extends object = Record<never, never>,
	Schema extends GraphQLSchema = GraphQLSchema,
	Plugins extends readonly GraxiaPlugin<any, any>[] = NoPlugins,
	Made extends object = object,
> {
	/**
	 * The schema to serve. A `SchemaWithContext<Ctx>` from `createSchema<Ctx>()`
	 * is checked at compile time: the context factory, the plugins and the
	 * core must produce `Ctx`. A plain `GraphQLSchema` is not checked.
	 */
	schema: Schema;
	/** Path served; `/graphql` by default. `false` serves any path (the host routes). */
	path?: string | false;
	/**
	 * Builds the context of each operation, merged over `serverContext`
	 * (`{ ...serverContext, ...returned }`), before `onContext` plugins run.
	 */
	context?: (init: ContextInit<HostCtx>) => MaybePromise<Made>;
	/**
	 * Makes `getContext()` work (an `AsyncLocalStorage` around each operation's
	 * execution). `true` by default; `false` skips it and `getContext()` throws.
	 */
	asyncContext?: boolean;
	/** Milliseconds `dispose()` waits for in-flight operations before aborting them. 10 000 by default. */
	shutdownTimeout?: number;
	/** Plugins (see `definePlugin`). */
	plugins?: Plugins;
	/** Document and body limits. */
	limits?: GraxiaLimits;
	/** Parse and validation caches, or `false` to disable both. */
	caches?: DocumentCaches;
	/** Batched operations (a JSON array body): off by default, or `{ limit }`. */
	batching?: BatchingOption;
	/** Subscriptions and streamed results over server-sent events (`sse`) and WebSocket (`ws`), both on by default. */
	subscriptions?: SubscriptionsOptions;
	/**
	 * `@defer` and `@stream` over `multipart/mixed` and server-sent events.
	 * Enabled by default (`true` or an object); `false` answers such a query
	 * with `INCREMENTAL_NOT_SUPPORTED` and runs graphql's plain `execute`.
	 */
	incremental?: boolean | IncrementalOptions;
	/**
	 * CSRF prevention and origin checks. On by default: a GET, or a POST that is not
	 * JSON, needs a CSRF header (see `DEFAULT_CSRF_HEADERS`); a WebSocket upgrade from
	 * another origin is refused. `false` turns all of it off.
	 */
	csrf?: false | CsrfOptions;
	/**
	 * Trusted documents: a manifest of allowed documents (Relay, graphql-codegen or Apollo),
	 * `documentId`, automatic persisted queries and a `strict` mode (on in production).
	 * Absent: no persisted documents and no APQ, queries run as sent.
	 */
	trustedDocuments?: TrustedDocumentsOptions;
	/**
	 * OpenTelemetry spans (`graphql.request`, `graphql.parse`, `graphql.validate`, one per
	 * operation, optional resolver spans). On when `@opentelemetry/api` (an optional peer) is
	 * installed, a no-op otherwise; `false` turns it off.
	 */
	telemetry?: false | TelemetryOptions;
	/**
	 * Answers `__schema` and `__type` queries. `true` unless `NODE_ENV` is `production`.
	 */
	introspection?: boolean;
	/**
	 * Keeps "Did you mean ..." hints in validation and variable errors. `true` unless
	 * `NODE_ENV` is `production`.
	 */
	suggestions?: boolean;
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
	/** Depth, aliases, directives, root fields and cost limits. */
	operationLimits: ResolvedOperationLimits;
	batching: BatchingOption;
	asyncContext: boolean;
	shutdownTimeout: number;
	sse: boolean;
	keepAliveMs: number;
	/** The WebSocket settings, or `false` when it is off. */
	ws: ResolvedWebSocket | false;
	/** The CSRF and origin checks, or `false` when they are off. */
	csrf: ResolvedCsrf | false;
	introspection: boolean;
	suggestions: boolean;
	/** The incremental delivery format, or `false` when it is off. */
	incremental: false | 'graphql17' | 'legacy';
}
