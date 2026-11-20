import { boundedRequest } from './body';
import { corsOrigin, preflight } from './cors';
import { checkOrigin, type OriginPolicy } from './origin';
import { refusal } from './refusal';

/** What the HTTP checks need. */
export interface PipelineSettings extends OriginPolicy {
	maxBody: number;
}

/**
 * The HTTP checks before the MCP handler, in order: origin and host (403),
 * CORS preflight, method (405), the optional `gate` (authentication, before
 * the body is read), content type (415) and body size (413). Resolves the
 * refusal, or a copy of the request whose body is read with the gate's result.
 */
export async function admit<T = undefined>(
	request: Request,
	settings: PipelineSettings,
	gate?: (request: Request) => Promise<T | Response>,
): Promise<Response | { request: Request; gated: T | undefined }> {
	const forbidden = checkOrigin(request, settings);
	if (forbidden) return forbidden;
	const cors = corsOrigin(request, settings.allowedOrigins);
	if (request.method === 'OPTIONS' && cors !== undefined)
		return preflight(
			cors,
			request.headers.get('access-control-request-headers'),
		);
	if (request.method !== 'POST')
		return refusal(
			405,
			`${request.method} is not supported: this endpoint is stateless.`,
			'Send the JSON-RPC message with POST. There is no server-initiated stream to open or session to close.',
			{ allow: 'POST' },
		);
	const gated = gate ? await gate(request) : undefined;
	if (gated instanceof Response) return gated;
	const bounded = await boundedRequest(request, settings.maxBody);
	return bounded instanceof Response ? bounded : { request: bounded, gated };
}
