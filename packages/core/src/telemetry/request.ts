import { requestIdKey } from '../http/request-id';
import type { RequestState } from '../plugins/state';
import { headerGetter } from './api';
import {
	ATTR,
	type Env,
	fail,
	type Live,
	parentKey,
	requestKey,
	SPAN,
	start,
} from './spans';

/** The code of a 4xx answer's first error (`graxia.refusal.code`), read from a copy of the body. */
async function refusalCode(response: Response): Promise<string | undefined> {
	if (response.status < 400 || response.status > 499) return undefined;
	if (!response.headers.get('content-type')?.includes('json')) return undefined;
	try {
		const text = await response.clone().text();
		if (text.length > 4096) return undefined;
		const code = JSON.parse(text)?.errors?.[0]?.extensions?.code;
		return typeof code === 'string' ? code : undefined;
	} catch {
		return undefined;
	}
}

/** Sets the status of the request span from the response and ends it. */
async function finish(
	env: Env,
	live: Live,
	response: Response | undefined,
	status: number | undefined,
): Promise<void> {
	const code = status ?? response?.status;
	if (code !== undefined) {
		live.span.setAttribute(ATTR.httpStatus, code);
		if (code >= 500)
			live.span.setStatus({ code: env.api.SpanStatusCode.ERROR });
	}
	const refusal = response ? await refusalCode(response) : undefined;
	if (refusal) live.span.setAttribute(ATTR.refusalCode, refusal);
	live.span.end();
}

/** The context a request hangs under: the active span's, else the one in its `traceparent`. */
function incoming(env: Env, request: Request) {
	const active = env.api.context.active();
	if (env.api.trace.getActiveSpan() || !env.propagate)
		return { active, kind: 'internal' };
	return {
		active: env.api.propagation.extract(active, request.headers, headerGetter),
		kind: 'server',
	};
}

/**
 * Runs `run` inside a `graphql.request` span. `upgrade` marks a WebSocket
 * handshake: it ends with the handshake, and the context it extracted is
 * kept for the operations of the socket. A stream response keeps the span
 * open until its `held` promises settle.
 */
export async function traceRequest<R extends Response | undefined>(
	env: Env,
	request: Request,
	state: RequestState,
	run: () => Promise<R>,
	upgrade: boolean,
): Promise<R> {
	const { active, kind } = incoming(env, request);
	state.set(parentKey, active);
	const id = state.get(requestIdKey);
	const live = start(
		env,
		SPAN.request,
		kind === 'internal' ? env.api.SpanKind.INTERNAL : env.api.SpanKind.SERVER,
		active,
		{
			[ATTR.httpMethod]: request.method,
			...(id ? { [ATTR.requestId]: id } : {}),
			...(upgrade ? { [ATTR.upgrade]: 1 } : {}),
		},
	);
	const held: Promise<unknown>[] = [];
	if (!upgrade) state.set(requestKey, { live, held });
	let response: R | undefined;
	try {
		response = await env.api.context.with(live.ctx, run);
		return response;
	} catch (error) {
		fail(env, live.span, error);
		throw error;
	} finally {
		const status = upgrade && response === undefined ? 101 : undefined;
		const end = () => finish(env, live, response, status);
		if (held.length > 0) void Promise.allSettled(held).then(end);
		else await end();
	}
}
