import { requestIdKey } from '../http/request-id';
import type { RequestState } from '../plugins/state';
import {
	ATTR,
	type Env,
	fail,
	type Live,
	parentKey,
	quietKey,
	requestKey,
	SPAN,
	start,
} from './spans';

/** The code of a 4xx answer's first error (`graxia.refusal.code`), read from a copy of the body. */
async function refusalCode(response: Response): Promise<string | undefined> {
	if (response.status < 400 || response.status > 499) return undefined;
	if (!response.headers.get('content-type')?.includes('json')) return undefined;
	// A refusal is small and declares its length; a body of unknown or large size is never read.
	const length = Number(response.headers.get('content-length') ?? Number.NaN);
	if (!(length <= 4096)) return undefined;
	try {
		const text = await response.clone().text();
		const code = JSON.parse(text)?.errors?.[0]?.extensions?.code;
		return typeof code === 'string' ? code : undefined;
	} catch {
		return undefined;
	}
}

/** Sets the status of the request span from the response and ends it. */
async function finish(
	live: Live,
	response: Response | undefined,
	status: number | undefined,
): Promise<void> {
	const code = status ?? response?.status;
	if (code !== undefined) {
		live.attribute(ATTR.httpStatus, code);
		if (code >= 500) live.status = 'error';
	}
	const refusal = response ? await refusalCode(response) : undefined;
	if (refusal) live.attribute(ATTR.refusalCode, refusal);
	live.end();
}

/**
 * A request span that records nothing (nothing installed, or sampled out):
 * the context still flows, but no clone, attribute or child span is made.
 */
async function untraced<R>(
	state: RequestState,
	live: Live,
	run: () => Promise<R>,
): Promise<R> {
	state.set(quietKey, true);
	try {
		return await live.run(run);
	} finally {
		live.end();
	}
}

/**
 * Runs `run` inside a `graphql.request` span. `upgrade` marks a WebSocket
 * handshake: it ends with the handshake, and the operations of the socket
 * hang under it. A stream response keeps the span open until its `held`
 * promises settle.
 */
export async function traceRequest<R extends Response | undefined>(
	env: Env,
	request: Request,
	state: RequestState,
	run: () => Promise<R>,
	upgrade: boolean,
): Promise<R> {
	// A span already active (a host's) is the parent; otherwise a `traceparent` header is.
	const nested = !env.propagate || env.api.currentSpan() !== undefined;
	const id = state.get(requestIdKey);
	const live = start(env, SPAN.request, undefined, {
		kind: nested ? 'internal' : 'server',
		traceparent: nested ? null : request.headers.get('traceparent'),
		attributes: {
			[ATTR.httpMethod]: request.method,
			...(id ? { [ATTR.requestId]: id } : {}),
			...(upgrade ? { [ATTR.upgrade]: 1 } : {}),
		},
	});
	state.set(parentKey, live);
	if (!live.context.sampled) return untraced(state, live, run);
	const held: Promise<unknown>[] = [];
	if (!upgrade) state.set(requestKey, { live, held });
	let response: R | undefined;
	try {
		response = await live.run(run);
		return response;
	} catch (error) {
		fail(live, error);
		throw error;
	} finally {
		const status = upgrade && response === undefined ? 101 : undefined;
		const end = () => finish(live, response, status);
		if (held.length > 0) void Promise.allSettled(held).then(end);
		else await end();
	}
}
