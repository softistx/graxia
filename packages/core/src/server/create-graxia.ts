import { createDocumentPipeline } from '../document/pipeline';
import { GraxiaConfigError } from '../errors/config-error';
import { DEFAULT_BODY_BYTES } from '../http/body';
import { createRequestId, requestIdKey } from '../http/request-id';
import { refusal } from '../http/respond';
import { createPluginEngine } from '../plugins/engine';
import { RequestState } from '../plugins/state';
import { dispatch } from './handle';
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
	return { path, bodyBytes, batching };
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
	const engine = createPluginEngine(options.plugins ?? []);
	const { bodyBytes: _bodyBytes, ...limits } = options.limits ?? {};
	const ready = engine.init();
	ready.catch(() => {});
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
		unexpected: createUnexpectedHandler(options.onUnexpected),
		context: options.context,
		ready,
	};
	const handleWith = async (
		request: Request,
		serverContext: Record<string, unknown>,
	) => {
		const state = new RequestState();
		state.set(requestIdKey, createRequestId());
		try {
			return seal(await handle(rt, request, serverContext, state), state);
		} catch (error) {
			return seal(rt.unexpected.respond(error, state), state);
		}
	};
	return {
		fetch: (request, serverContext) =>
			handleWith(request, { ...serverContext }),
		serve: (serveOptions) =>
			Bun.serve<undefined>({
				...serveOptions,
				fetch: (request, server) => handleWith(request, { server }),
			}),
	};
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
