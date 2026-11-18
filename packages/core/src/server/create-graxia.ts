import { createDocumentPipeline } from '../document/pipeline';
import { GraxiaConfigError } from '../errors/config-error';
import { DEFAULT_BODY_BYTES } from '../http/body';
import { createRequestId, requestIdKey } from '../http/request-id';
import { refusal } from '../http/respond';
import { createPluginEngine } from '../plugins/engine';
import { RequestState } from '../plugins/state';
import { createDispose } from './dispose';
import { dispatch } from './handle';
import { createLifecycle } from './lifecycle';
import { createResultMasker } from './masking';
import type { GraxiaOptions, ResolvedOptions } from './options';
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
	 * operation's context. Never rejects.
	 */
	fetch(request: Request, serverContext?: HostCtx): Promise<Response>;
	/** Starts `Bun.serve` with this instance as its `fetch`. */
	serve(options?: GraxiaServeOptions): Bun.Server<undefined>;
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
	return { path, bodyBytes, batching, asyncContext, shutdownTimeout };
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
	ready.catch(() => {});
	const unexpected = createUnexpectedHandler(options.onUnexpected);
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
	) => {
		const state = new RequestState();
		state.set(requestIdKey, createRequestId());
		if (lifecycle.closing) return seal(shuttingDown(), state);
		try {
			return seal(
				await lifecycle.track(handle(rt, request, serverContext, state)),
				state,
			);
		} catch (error) {
			return seal(rt.unexpected.respond(error, state), state);
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
	return {
		fetch: (request, serverContext) =>
			handleWith(request, { ...serverContext }),
		serve: (serveOptions) => {
			const server = Bun.serve<undefined>({
				...serveOptions,
				fetch: (request, server) => handleWith(request, { server }),
			});
			servers.push(server);
			return server;
		},
		dispose,
		[Symbol.asyncDispose]: () => dispose(),
	};
}

/** What a request arriving after `dispose()` started gets. */
function shuttingDown(): Response {
	return refusal(
		503,
		'Server is shutting down.',
		{ connection: 'close' },
		'SHUTTING_DOWN',
	);
}

/** Path and method refusals, plugins around the dispatch; never rejects. */
async function handle(
	rt: Runtime,
	request: Request,
	serverContext: Record<string, unknown>,
	state: RequestState,
): Promise<Response> {
	const { path } = rt.options;
	if (path !== false && new URL(request.url).pathname !== path)
		return refusal(404, 'Not found.');
	if (request.method !== 'GET' && request.method !== 'POST')
		return refusal(405, 'Only GET and POST are allowed.', {
			allow: 'GET, POST',
		});
	try {
		await rt.ready;
		const entered = await rt.engine.runners.onRequest({ request, state });
		let response =
			entered.error !== undefined
				? rt.unexpected.respond(entered.error, state)
				: (entered.out.response ??
					(await dispatch(rt, request, serverContext, state)));
		const afterError = await entered.runAfter({ response }).then(
			() => undefined,
			(error: unknown) => error,
		);
		if (afterError !== undefined && entered.error === undefined)
			response = rt.unexpected.respond(afterError, state);
		const last = await rt.engine.runners.onResponse({
			request,
			state,
			response,
		});
		return last.error !== undefined
			? rt.unexpected.respond(last.error, state)
			: last.out.response;
	} catch (error) {
		return rt.unexpected.respond(error, state);
	}
}
