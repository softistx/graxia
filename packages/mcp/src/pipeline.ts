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
 * CORS preflight, method (405), content type (415) and body size (413).
 * Resolves the refusal, or a copy of the request whose body is read.
 */
export async function admit(
	request: Request,
	settings: PipelineSettings,
): Promise<Response | Request> {
	const forbidden = checkOrigin(request, settings);
	if (forbidden) return forbidden;
	const cors = corsOrigin(request, settings.allowedOrigins);
	if (request.method === 'OPTIONS' && cors !== undefined)
		return preflight(cors);
	if (request.method !== 'POST')
		return refusal(
			405,
			`${request.method} is not supported: this endpoint is stateless.`,
			'Send the JSON-RPC message with POST. There is no server-initiated stream to open or session to close.',
			{ allow: 'POST' },
		);
	return boundedRequest(request, settings.maxBody);
}
