import type { ExecutionResult, GraphQLSchema } from 'graphql';
import type { ExecuteArgs } from './execute';
import type { OptionsArg, ServerContextArg } from './host-context';
import type { GraxiaServeOptions, GraxiaSocketData } from './serve-options';

/** A graxia server instance. */
export interface Graxia<HostCtx extends object = Record<never, never>> {
	/**
	 * Handles one request: a Web `Request` in, a `Response` out. Mount it in
	 * your own `Bun.serve` routes. `serverContext` is merged into every
	 * operation's context; it is required when `HostCtx` has required keys.
	 * Never rejects.
	 */
	fetch(
		request: Request,
		...serverContext: ServerContextArg<HostCtx>
	): Promise<Response>;
	/**
	 * Runs one operation in process (tests, server-side jobs): a synthetic
	 * `POST` request goes through the same pipeline as HTTP (plugins, context,
	 * request id, `dispose` tracking, masking) and the masked result comes
	 * back as an object, with no content negotiation or HTTP encoding.
	 * A string document gets the parse limits and both caches; a `DocumentNode`
	 * skips them. Variables travel as JSON. Subscriptions and incremental results return their usual refusal error
	 * in the result (subscriptions are served over `fetch` with `Accept: text/event-stream`). Rejects with a {@link GraxiaExecuteError} when the request
	 * ends without a result (a plugin's `respond`, an unexpected failure) and
	 * after `dispose()`.
	 *
	 * @example
	 * const { data } = await graxia.execute({ document: '{ hello }' });
	 */
	execute<Result = Record<string, any>, Variables = Record<string, any>>(
		args: ExecuteArgs<Result, Variables, HostCtx>,
	): Promise<ExecutionResult<Result>>;
	/**
	 * Resolves once every plugin's `setup` ran; rejects with the
	 * `GraxiaPluginError` of the first one that failed (also reported once
	 * through `onUnexpected`, phase `setup`). Await it at startup to fail fast;
	 * until then requests wait for it, and answer a 500 when it rejected.
	 */
	readonly ready: Promise<void>;
	/**
	 * Starts `Bun.serve` with this instance as its `fetch`. The context of each
	 * operation holds `serverContext` (required when `HostCtx` has required keys)
	 * and `server`, the `Bun.Server`.
	 */
	serve(
		...options: OptionsArg<HostCtx, GraxiaServeOptions>
	): Bun.Server<GraxiaSocketData>;
	/**
	 * Upgrades a request to a `graphql-transport-ws` socket from your own
	 * `Bun.serve` `fetch`; pass {@link Graxia.websocket} as its `websocket`.
	 * Resolves `undefined` once the socket is upgraded (return it from `fetch`),
	 * else the `Response` to send: the refusal (wrong path, a plugin's
	 * `respond`, no `graphql-transport-ws` subprotocol, shutdown), sealed, with
	 * the request id. Guard it with {@link Graxia.isUpgrade}: on a request that
	 * is not an upgrade (or with `subscriptions.ws` off) it answers like
	 * {@link Graxia.fetch}, so its hooks run once either way.
	 * `serverContext` is required when `HostCtx` has required keys.
	 *
	 * @example
	 * const server = Bun.serve({
	 *   fetch: (request, server) =>
	 *     graxia.isUpgrade(request)
	 *       ? graxia.upgrade(request, server)
	 *       : graxia.fetch(request, { server }),
	 *   websocket: graxia.websocket,
	 * });
	 */
	upgrade(
		request: Request,
		server: Bun.Server<GraxiaSocketData>,
		...serverContext: ServerContextArg<HostCtx>
	): Promise<Response | undefined>;
	/** Whether `request` asks for a WebSocket upgrade (`Upgrade: websocket`) and `subscriptions.ws` is on. */
	isUpgrade(request: Request): boolean;
	/** The `Bun.serve` `websocket` handler of this instance (see {@link Graxia.upgrade}). */
	readonly websocket: Bun.WebSocketHandler<GraxiaSocketData>;
	/**
	 * Shuts down: stops accepting requests (new ones answer 503
	 * `SHUTTING_DOWN`), stops the `serve()` servers, waits for in-flight
	 * operations up to `timeout` ms (default `shutdownTimeout`, 10 000), aborts
	 * what remains through their `signal`, then runs the plugins' `onDispose`
	 * in reverse order. Idempotent: later calls return the same promise.
	 */
	dispose(options?: { timeout?: number }): Promise<void>;
	/** The schema this instance serves, as given to {@link createGraxia}. */
	readonly schema: GraphQLSchema;
	/**
	 * The document limits in force, defaults applied: a layer in front of
	 * the instance (an MCP server, a proxy) reads them to enforce the same.
	 * `tokens` is `false` when the limit is off.
	 */
	readonly limits: {
		/** The largest request body in bytes (`limits.bodyBytes`, 1 MiB by default). */
		readonly bodyBytes: number;
		/** The most tokens of a document (`limits.tokens`, 15 000 by default). */
		readonly tokens: number | false;
	};
	/**
	 * The trusted-documents mode in force (the `NODE_ENV` default applied), or
	 * `undefined` without `trustedDocuments`. A layer that runs documents
	 * through {@link Graxia.execute} on a client's behalf (an MCP server) reads
	 * it: `execute` is in process and runs any document, so in `strict` that
	 * layer must not take documents from its clients.
	 */
	readonly trustedDocuments: { readonly mode: 'strict' | 'mixed' } | undefined;
	/** `await using graxia = createGraxia(...)` calls {@link Graxia.dispose}. */
	[Symbol.asyncDispose](): Promise<void>;
}
