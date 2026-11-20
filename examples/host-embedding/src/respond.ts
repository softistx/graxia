import type { ResponseSet } from './context';

/**
 * Merges what resolvers set (headers, cookies) into graxia's response.
 * Only a single result is still in the host's hands: a streamed response
 * (SSE, multipart) has already left, and a socket has no response at all.
 */
export function withResponseSet(
	response: Response,
	set: ResponseSet,
): Response {
	const headers = new Headers(response.headers);
	for (const [name, value] of set.headers)
		if (name !== 'content-type') headers.set(name, value);
	for (const cookie of set.cookies.toSetCookieHeaders())
		headers.append('set-cookie', cookie);
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}
