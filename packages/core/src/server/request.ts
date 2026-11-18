import { refusal } from '../http/respond';
import type { StateBag } from '../plugins/state';
import { checkRequest } from '../security/check';
import { inProcessKey } from './execute-state';
import { dispatch } from './handle';
import type { Runtime } from './runtime';
import { seal } from './seal';

/**
 * The answer when sealing the response failed (a plugin produced a response
 * Bun refuses): the generic 500, sealed; if even that fails, a bare 500.
 * `fetch` never rejects.
 */
export function lastResort(
	rt: Runtime,
	error: unknown,
	state: StateBag,
): Response {
	try {
		return seal(rt.unexpected.respond(error, state), state);
	} catch {
		return new Response(null, { status: 500 });
	}
}

/** What a request arriving after `dispose()` started gets. */
export function shuttingDown(): Response {
	return refusal(
		503,
		'Server is shutting down.',
		{ connection: 'close' },
		'SHUTTING_DOWN',
	);
}

/** Path and method refusals, plugins around the dispatch; never rejects. */
export async function handle(
	rt: Runtime,
	request: Request,
	serverContext: Record<string, unknown>,
	state: StateBag,
): Promise<Response> {
	const { path } = rt.options;
	if (path !== false && new URL(request.url).pathname !== path)
		return refusal(404, 'Not found.');
	if (request.method !== 'GET' && request.method !== 'POST')
		return refusal(405, 'Only GET and POST are allowed.', {
			allow: 'GET, POST',
		});
	return rt.telemetry.request(request, state, () =>
		respond(rt, request, serverContext, state),
	);
}

/** The answer of a request on the GraphQL path, `onResponse` hooks included. */
async function respond(
	rt: Runtime,
	request: Request,
	serverContext: Record<string, unknown>,
	state: StateBag,
): Promise<Response> {
	try {
		await rt.ready;
		const response = await answer(rt, request, serverContext, state);
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

/**
 * The response before `onResponse`: the built-in security refusals first (a
 * forged request never reaches a plugin), then `onRequest`, the dispatch and
 * the after-hooks.
 */
async function answer(
	rt: Runtime,
	request: Request,
	serverContext: Record<string, unknown>,
	state: StateBag,
): Promise<Response> {
	const forbidden = state.get(inProcessKey)
		? undefined
		: checkRequest(rt, request);
	if (forbidden) return forbidden;
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
	return response;
}
