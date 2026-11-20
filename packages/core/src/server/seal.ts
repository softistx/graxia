import { errorHeadersOf } from '../http/error-http';
import { takeOwn } from '../http/own-response';
import {
	createRequestId,
	REQUEST_ID_HEADER,
	requestIdKey,
} from '../http/request-id';
import type { RequestState } from '../plugins/state';

/** Headers a plugin adds that stack instead of replacing. */
const APPENDED = new Set(['set-cookie', 'vary']);

/**
 * The final response: the plugins' `responseHeaders` merged in
 * (`set-cookie` and `vary` appended, any other header set only when the
 * response does not carry it) and `x-request-id` set to the id graxia
 * generated, replacing whatever a client or a plugin put there. Throws a
 * `RangeError` for a status Bun refuses (the caller answers a 500).
 */
export function seal(response: Response, state: RequestState): Response {
	// Bun refuses `Response.error()` (status 0) and other non-HTTP statuses.
	if (response.status < 200 || response.status > 599)
		throw new RangeError(`A response cannot have status ${response.status}`);
	const id = state.get(requestIdKey) ?? createRequestId();
	// Looked up for this very object, before any rebuild gives another one.
	const fromErrors = errorHeadersOf(response);
	// Only a response graxia built for this request is changed in place: any
	// other may be shared across requests (a cache, a constant) and keep its headers.
	if (takeOwn(response)) {
		try {
			response.headers.set(REQUEST_ID_HEADER, id); // probe: throws on immutable headers
			merge(response.headers, state);
			addErrorHeaders(response.headers, fromErrors);
			response.headers.set(REQUEST_ID_HEADER, id); // a plugin's x-request-id never wins
			return response;
		} catch {
			// Immutable after all: rebuilt below.
		}
	}
	// Rebuilt rather than mutated: a Response from `fetch` or `Response.redirect` is immutable.
	const headers = new Headers(response.headers);
	merge(headers, state);
	addErrorHeaders(headers, fromErrors);
	headers.set(REQUEST_ID_HEADER, id);
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

function merge(headers: Headers, state: RequestState): void {
	for (const [name, value] of state.responseHeaders) {
		if (name === 'set-cookie') continue;
		if (APPENDED.has(name)) headers.append(name, value);
		else if (!headers.has(name)) headers.set(name, value);
	}
	for (const cookie of state.responseHeaders.getSetCookie())
		headers.append('set-cookie', cookie);
}

/** The headers the result's errors ask for, last, for the names nothing else set. */
function addErrorHeaders(
	headers: Headers,
	asked: Record<string, string> | undefined,
): void {
	for (const [name, value] of Object.entries(asked ?? {}))
		if (!headers.has(name)) headers.set(name, value);
}
