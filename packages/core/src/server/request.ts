import { takeOwn } from '../http/own-response';
import { refusal } from '../http/respond';
import { NO_AFTER } from '../plugins/stage';
import type { StateBag } from '../plugins/state';
import { checkRequest, exemptRefusal } from '../security/check';
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
		'Retry the request in a few seconds, once the server is back.',
		{ headers: { connection: 'close' }, code: 'SHUTTING_DOWN' },
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
		return refusal(
			404,
			'Not found.',
			`Send the request to the GraphQL path, ${path}.`,
			{ code: 'PATH_NOT_FOUND' },
		);
	if (request.method !== 'GET' && request.method !== 'POST')
		return refusal(
			405,
			'Only GET and POST are allowed.',
			'Use GET for queries or POST for any operation.',
			{ headers: { allow: 'GET, POST' }, code: 'METHOD_NOT_ALLOWED' },
		);
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
		// A plugin may keep the response it sees: it is then rebuilt, never sealed in place.
		if (rt.engine.has('onResponse')) takeOwn(response);
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
	const inProcess = state.get(inProcessKey) === true;
	const exempt =
		!inProcess &&
		rt.engine.csrfExempt(request, (error) =>
			rt.unexpected.report(error, state, 'request'),
		);
	const forbidden = inProcess ? undefined : checkRequest(rt, request, exempt);
	if (forbidden) return forbidden;
	const entered = await rt.engine.runners.onRequest({ request, state });
	// An exempt request is answered by a plugin or refused as it would have
	// been: it never reaches the dispatch.
	let response =
		entered.error !== undefined
			? rt.unexpected.respond(entered.error, state)
			: (entered.out.response ??
				(exempt ? exemptRefusal(rt, request) : undefined) ??
				(await dispatch(rt, request, serverContext, state)));
	if (entered.runAfter !== NO_AFTER) takeOwn(response);
	const afterError =
		entered.runAfter === NO_AFTER
			? undefined
			: await entered.runAfter({ response }).then(
					() => undefined,
					(error: unknown) => error,
				);
	if (afterError !== undefined && entered.error === undefined)
		response = rt.unexpected.respond(afterError, state);
	return response;
}
