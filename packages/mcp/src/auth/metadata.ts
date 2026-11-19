import type { ResolvedAuth } from './types';

const CORS = { 'access-control-allow-origin': '*' };

/**
 * The RFC 9728 protected resource metadata handler: GET only, CORS `*`,
 * cached an hour. The write scope is published only when `mutations` is on:
 * without it no tool needs that scope.
 */
export function metadataHandler(
	auth: ResolvedAuth | undefined,
	mutations: boolean,
): (request: Request) => Response {
	if (auth === undefined) return () => new Response(null, { status: 404 });
	const { options } = auth;
	const body = JSON.stringify({
		resource: options.resource,
		authorization_servers: options.authorizationServers,
		scopes_supported: mutations ? [auth.read, auth.write] : [auth.read],
		bearer_methods_supported: ['header'],
		...(options.resourceName !== undefined && {
			resource_name: options.resourceName,
		}),
		...(options.documentation !== undefined && {
			resource_documentation: options.documentation,
		}),
	});
	return (request) => {
		if (request.method === 'OPTIONS')
			return new Response(null, {
				status: 204,
				headers: {
					...CORS,
					'access-control-allow-methods': 'GET',
					'access-control-max-age': '3600',
				},
			});
		if (request.method !== 'GET' && request.method !== 'HEAD')
			return new Response(null, {
				status: 405,
				headers: { ...CORS, allow: 'GET, HEAD, OPTIONS' },
			});
		return new Response(request.method === 'HEAD' ? null : body, {
			headers: {
				...CORS,
				'content-type': 'application/json',
				'cache-control': 'max-age=3600',
			},
		});
	};
}
