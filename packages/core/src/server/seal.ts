import { REQUEST_ID_HEADER, requestIdKey } from '../http/request-id';
import type { RequestState } from '../plugins/state';

/** Headers a plugin adds that stack instead of replacing. */
const APPENDED = new Set(['set-cookie', 'vary']);

/**
 * The final response: the plugins' `responseHeaders` merged in
 * (`set-cookie` and `vary` appended, any other header set only when the
 * response does not carry it) and `x-request-id` set to the id graxia
 * generated, replacing whatever a client or a plugin put there.
 */
export function seal(response: Response, state: RequestState): Response {
	const headers = new Headers(response.headers);
	for (const [name, value] of state.responseHeaders) {
		if (name === 'set-cookie') continue;
		if (APPENDED.has(name)) headers.append(name, value);
		else if (!headers.has(name)) headers.set(name, value);
	}
	for (const cookie of state.responseHeaders.getSetCookie())
		headers.append('set-cookie', cookie);
	headers.set(REQUEST_ID_HEADER, state.require(requestIdKey));
	// Rebuilt rather than mutated: a Response from `fetch` or `Response.redirect` is immutable.
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}
