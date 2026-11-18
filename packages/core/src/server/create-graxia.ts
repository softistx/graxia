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
import { handleUnexpected } from './unexpected';

/** The options `Bun.serve` takes, minus `fetch` (graxia provides it). */
export type GraxiaServeOptions = Omit<Bun.Serve.Options<undefined>, 'fetch'>;

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
		context: options.context,
		ready,
	};
	const handleFetch = async (request: Request, serverContext?: HostCtx) => {
		const state = new RequestState();
		state.set(requestIdKey, createRequestId());
		const response = await handle(rt, request, serverContext ?? {}, state);
		return seal(response, state);
	};
	return {
		fetch: handleFetch,
		serve: (serveOptions) =>
			Bun.serve({
				...serveOptions,
				fetch: (request: Request) => handleFetch(request),
			} as unknown as Bun.Serve.Options<undefined>),
	};
}

/** Path and method refusals, plugins around the dispatch; never rejects. */
async function handle(
	rt: Runtime,
	request: Request,
	serverContext: object,
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
				? handleUnexpected(entered.error)
				: (entered.out.response ??
					(await dispatch(
						rt,
						request,
						serverContext as Record<string, unknown>,
						state,
					)));
		const afterError = await entered.runAfter({ response }).then(
			() => undefined,
			(error: unknown) => error,
		);
		if (afterError !== undefined && entered.error === undefined)
			response = handleUnexpected(afterError);
		const last = await rt.engine.runners.onResponse({
			request,
			state,
			response,
		});
		return last.error !== undefined
			? handleUnexpected(last.error)
			: last.out.response;
	} catch (error) {
		return handleUnexpected(error);
	}
}
