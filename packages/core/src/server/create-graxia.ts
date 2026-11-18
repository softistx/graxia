import type { ExecutionResult } from 'graphql';
import { createDocumentPipeline } from '../document/pipeline';
import { GraxiaConfigError } from '../errors/config-error';
import { DEFAULT_BODY_BYTES } from '../http/body';
import { resolveOperationLimits } from '../limits/options';
import { operationLimitRules } from '../limits/rules';
import { createPluginEngine } from '../plugins/engine';
import { StateBag } from '../plugins/state';
import { csrfHeaderKey } from '../security/header-key';
import { noIntrospectionRule } from '../security/introspection';
import { resolveSecurity } from '../security/options';
import { createTelemetry } from '../telemetry';
import { resolveTrusted } from '../trusted/options';
import { createTrustedDocuments } from '../trusted/resolve';
import { createDispose } from './dispose';
import { createEntry } from './entry';
import { createExecute, type ExecuteArgs } from './execute';
import type { OptionsArg, ServerContextArg } from './host-context';
import { createLifecycle } from './lifecycle';
import { createResultMasker } from './masking';
import type { GraxiaOptions, ResolvedOptions } from './options';
import type { Runtime } from './runtime';
import type { GraxiaServeOptions, GraxiaSocketData } from './serve-options';
import { resolveStreaming } from './streaming-options';
import { createUnexpectedHandler } from './unexpected';

export type { GraxiaServeOptions, GraxiaSocketData };

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
	/** `await using graxia = createGraxia(...)` calls {@link Graxia.dispose}. */
	[Symbol.asyncDispose](): Promise<void>;
}

function resolve(options: GraxiaOptions<any>): ResolvedOptions {
	const bodyBytes = options.limits?.bodyBytes ?? DEFAULT_BODY_BYTES;
	if (!Number.isInteger(bodyBytes) || bodyBytes < 1)
		throw new GraxiaConfigError('limits.bodyBytes must be a positive integer');
	const operationLimits = resolveOperationLimits(options.limits);
	const batching = options.batching ?? false;
	if (
		batching !== false &&
		(!Number.isInteger(batching.limit) || batching.limit < 1)
	)
		throw new GraxiaConfigError('batching.limit must be a positive integer');
	const path = options.path ?? '/graphql';
	if (path !== false && !path.startsWith('/'))
		throw new GraxiaConfigError('path must start with "/" (or be false)');
	const asyncContext = options.asyncContext ?? true;
	const shutdownTimeout = options.shutdownTimeout ?? 10_000;
	if (!Number.isInteger(shutdownTimeout) || shutdownTimeout < 0)
		throw new GraxiaConfigError(
			'shutdownTimeout must be a non-negative integer (milliseconds)',
		);
	return {
		path,
		bodyBytes,
		operationLimits,
		batching,
		asyncContext,
		shutdownTimeout,
		...resolveSecurity(options),
		...resolveStreaming(options),
	};
}

/**
 * Creates a graxia server over `schema`: GraphQL over HTTP on Bun.
 *
 * @example
 * const graxia = createGraxia({ schema });
 * graxia.serve({ port: 3000 }); // or: Bun.serve({ fetch: graxia.fetch })
 */
export function createGraxia<HostCtx extends object = Record<never, never>>(
	options: GraxiaOptions<HostCtx>,
): Graxia<HostCtx> {
	const resolved = resolve(options);
	const trusted = resolveTrusted(options.trustedDocuments);
	// Before `engine.init()`: a bad option throws before any plugin's setup runs.
	const telemetry = createTelemetry(options.telemetry, options.schema);
	const lifecycle = createLifecycle();
	const servers: Bun.Server<GraxiaSocketData>[] = [];
	const engine = createPluginEngine(options.plugins ?? []);
	const ready = engine.init();
	// Handled here so a failing `setup` is never an unhandled rejection; reported once.
	ready.catch(() => {});
	const unexpected = createUnexpectedHandler(options.onUnexpected);
	ready.catch((error: unknown) =>
		unexpected.report(error, new StateBag(), 'setup'),
	);
	const rt: Runtime = {
		schema: options.schema,
		engine,
		pipeline: createDocumentPipeline({
			schema: options.schema,
			engine,
			...(options.limits ? { limits: options.limits } : {}),
			rules: [
				...operationLimitRules(resolved.operationLimits),
				...(resolved.introspection ? [] : [noIntrospectionRule]),
			],
			hideSuggestions: !resolved.suggestions,
			...(options.caches !== undefined ? { caches: options.caches } : {}),
		}),
		options: resolved,
		unexpected,
		maskResult: createResultMasker(
			options.maskError,
			options.maskErrors ?? true,
			options.schema,
			unexpected,
		),
		trusted:
			trusted &&
			createTrustedDocuments(trusted, (error, state) =>
				unexpected.report(error, state),
			),
		context: options.context,
		lifecycle,
		telemetry,
		ready,
	};
	const entry = createEntry<HostCtx>(rt, servers);
	const dispose = createDispose({
		lifecycle,
		engine,
		ready,
		servers,
		unexpected: rt.unexpected,
		timeout: resolved.shutdownTimeout,
	});
	const execute = createExecute({
		run: entry.handleWith,
		lifecycle,
		path: resolved.path,
	});
	const graxia: Graxia<HostCtx> = {
		ready,
		execute,
		fetch: entry.fetch,
		serve: entry.serve,
		upgrade: entry.upgrade,
		isUpgrade: entry.isUpgrade,
		websocket: entry.websocket,
		dispose,
		[Symbol.asyncDispose]: () => dispose(),
	};
	// @internal: lets the test client send the instance's CSRF header on a GET.
	const header = resolved.csrf === false ? undefined : resolved.csrf.headers;
	Object.defineProperty(graxia, csrfHeaderKey, {
		value: header ? header[0] : undefined,
	});
	return graxia;
}
