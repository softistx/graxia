import { hasCsrfHeader, isSimpleRequest } from './csrf';
import type { ResolvedCsrf } from './options';
import { forbidden } from './refuse';

const FIX =
	'Add the origin to csrf.sameOrigin.allowedOrigins (for example { sameOrigin: { allowedOrigins: ["https://app.example.com"] } }).';

/**
 * Checks the `Origin` of a request. Over HTTP it runs only when `csrf.sameOrigin`
 * is on; a WebSocket upgrade is always checked (cross-site WebSocket hijacking),
 * and refused unless its origin is the server's own or in `allowedOrigins`.
 * A request with no `Origin` and no cross-site signal is not a browser's and passes.
 * Gives the 403 to send, or `undefined`.
 */
export function checkOrigin(
	request: Request,
	csrf: ResolvedCsrf,
	websocket: boolean,
): Response | undefined {
	if (!websocket && !csrf.sameOrigin) return undefined;
	const origin = request.headers.get('origin');
	const refuse = (from: string) =>
		forbidden(
			request,
			`Cross-origin request refused from ${from}.`,
			'FORBIDDEN_ORIGIN',
			FIX,
		);
	if (origin === null)
		return request.headers.get('sec-fetch-site') === 'cross-site' &&
			!permits(request, csrf, websocket)
			? refuse('an unknown origin')
			: undefined;
	if (origin === 'null') return refuse('a null origin');
	if (origin === new URL(request.url).origin || csrf.allowedOrigins.has(origin))
		return undefined;
	return permits(request, csrf, websocket) ? undefined : refuse(origin);
}

/** Whether `crossOrigin` lets a request from another origin through. */
function permits(
	request: Request,
	csrf: ResolvedCsrf,
	websocket: boolean,
): boolean {
	if (websocket) return false;
	if (csrf.crossOrigin === 'allow') return true;
	if (csrf.crossOrigin === 'refuse') return false;
	return (
		!isSimpleRequest(request) ||
		(csrf.headers !== false && hasCsrfHeader(request, csrf.headers))
	);
}
