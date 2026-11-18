import type { ExecutionResult } from 'graphql';
import { createDocumentPipeline } from '../document/pipeline';
import { GraxiaConfigError } from '../errors/config-error';
import { DEFAULT_BODY_BYTES } from '../http/body';
import { createRequestId, requestIdKey } from '../http/request-id';
import { createPluginEngine } from '../plugins/engine';
import { StateBag } from '../plugins/state';
import { createDispose } from './dispose';
import { createExecute, type ExecuteArgs } from './execute';
import type { OptionsArg, ServerContextArg } from './host-context';
import { createLifecycle } from './lifecycle';
import { createResultMasker } from './masking';
import type { GraxiaOptions, ResolvedOptions } from './options';
import { handle, lastResort, shuttingDown } from './request';
import type { Runtime } from './runtime';
import { seal } from './seal';
import { createUnexpectedHandler } from './unexpected';

/** The `Bun.serve` options graxia forwards (host and port; not `fetch`, `routes` or unix sockets). */
export type GraxiaServeOptions = Bun.Serve.HostnamePortServeOptions<undefined>;

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
	): Bun.Server<undefined>;
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
	const keepAliveMs = options.subscriptions?.keepAliveMs ?? 12_000;
	if (!Number.isFinite(keepAliveMs) || keepAliveMs <= 0)
		throw new GraxiaConfigError(
			'subscriptions.keepAliveMs must be a finite number above 0 (milliseconds)',
		);
	const sse = options.subscriptions?.sse ?? true;
	return {
		path,
		bodyBytes,
		batching,
		asyncContext,
		shutdownTimeout,
		sse,
		keepAliveMs,
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
	const lifecycle = createLifecycle();
	const servers: Bun.Server<undefined>[] = [];
	const engine = createPluginEngine(options.plugins ?? []);
	const { bodyBytes: _bodyBytes, ...limits } = options.limits ?? {};
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
			limits,
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
		context: options.context,
		lifecycle,
		ready,
	};
	const handleWith = async (
		request: Request,
		serverContext: Record<string, unknown>,
		state = new StateBag(),
	) => {
		state.set(requestIdKey, createRequestId());
		if (lifecycle.closing) return seal(shuttingDown(), state);
		try {
			return seal(
				await lifecycle.track(handle(rt, request, serverContext, state)),
				state,
			);
		} catch (error) {
			return lastResort(rt, error, state);
		}
	};
	const dispose = createDispose({
		lifecycle,
		engine,
		ready,
		servers,
		unexpected: rt.unexpected,
		timeout: resolved.shutdownTimeout,
	});
	const execute = createExecute({
		run: handleWith,
		lifecycle,
		path: resolved.path,
	});
	return {
		ready,
		execute,
		fetch: (request, ...[serverContext]) =>
			handleWith(request, { ...serverContext }),
		serve: (...[serveOptions]) => {
			const { serverContext, ...bunOptions } = serveOptions ?? {};
			const server = Bun.serve<undefined>({
				...(bunOptions as GraxiaServeOptions),
				fetch: (request, server) =>
					handleWith(request, { ...serverContext, server }),
			});
			servers.push(server);
			return server;
		},
		dispose,
		[Symbol.asyncDispose]: () => dispose(),
	};
}
