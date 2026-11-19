const ALLOW_HEADERS =
	'content-type, authorization, mcp-protocol-version, mcp-session-id, mcp-method, mcp-name, last-event-id, accept';

/** The origin to echo in `Access-Control-Allow-Origin`: the request's, when `allowed` lists it. */
export function corsOrigin(
	request: Request,
	allowed: readonly string[],
): string | undefined {
	const origin = request.headers.get('origin');
	return origin !== null && allowed.includes(origin) ? origin : undefined;
}

/** The answer to a preflight from an allowed origin. */
export function preflight(origin: string, requested?: string | null): Response {
	return new Response(null, {
		status: 204,
		headers: {
			'access-control-allow-origin': origin,
			'access-control-allow-methods': 'POST',
			'access-control-allow-headers': requested
				? `${ALLOW_HEADERS}, ${requested}`
				: ALLOW_HEADERS,
			'access-control-max-age': '600',
			vary: 'Origin',
		},
	});
}

/** `response` with the CORS headers of an allowed origin (unchanged when `origin` is undefined). */
export function withCors(
	response: Response,
	origin: string | undefined,
): Response {
	if (
		origin === undefined ||
		response.headers.has('access-control-allow-origin')
	)
		return response;
	const headers = new Headers(response.headers);
	headers.set('access-control-allow-origin', origin);
	headers.set('access-control-expose-headers', 'mcp-protocol-version');
	headers.append('vary', 'Origin');
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}
