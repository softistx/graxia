/**
 * CORS belongs to the host: graxia has no `cors` option. One allow list,
 * answered to a preflight and added to the real response.
 */
export function cors(allowed: readonly string[]) {
	const allows = (request: Request) => {
		const origin = request.headers.get('origin');
		return origin !== null && allowed.includes(origin) ? origin : undefined;
	};
	return {
		/** Answers a preflight from an allowed origin; `undefined` for any other request. */
		preflight(request: Request): Response | undefined {
			if (request.method !== 'OPTIONS') return undefined;
			const origin = allows(request);
			if (origin === undefined) return new Response(null, { status: 403 });
			return new Response(null, {
				status: 204,
				headers: {
					'access-control-allow-origin': origin,
					'access-control-allow-methods': 'GET, POST',
					'access-control-allow-headers': 'content-type, x-graphql-csrf',
					'access-control-max-age': '600',
					vary: 'origin',
				},
			});
		},
		/** Adds the allow headers to a response for an allowed origin. */
		decorate(request: Request, response: Response): Response {
			const origin = allows(request);
			if (origin === undefined) return response;
			response.headers.set('access-control-allow-origin', origin);
			response.headers.append('vary', 'origin');
			return response;
		},
	};
}
