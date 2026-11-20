import { hasCsrfHeader, isSimpleRequest } from './csrf';
import type { OriginRefusalReason, ResolvedCsrf } from './options';
import { forbidden } from './refuse';

const FIX =
	'Add the origin to csrf.sameOrigin.allowedOrigins (for example { sameOrigin: { allowedOrigins: ["https://app.example.com"] } }).';

/**
 * Checks the `Origin` of a request. Over HTTP it runs only when `csrf.sameOrigin`
 * is on; a WebSocket upgrade is always checked (cross-site WebSocket hijacking),
 * and refused unless its origin is the server's own or in `allowedOrigins`.
 * A request with no `Origin` and no cross-site signal is not a browser's and passes.
 * Gives the 403 to send (or what `csrf.sameOrigin.onRefused` answers), or `undefined`.
 */
export function checkOrigin(
	request: Request,
	csrf: ResolvedCsrf,
	websocket: boolean,
): Response | Promise<Response> | undefined {
	if (!websocket && !csrf.sameOrigin) return undefined;
	const origin = request.headers.get('origin');
	const refuse = (reason: OriginRefusalReason, from: string) =>
		refusalOf(request, csrf, websocket, reason, from);
	if (origin === null)
		return crossSite(request) && !permits(request, csrf, websocket)
			? refuse('no-origin', 'an unknown origin')
			: undefined;
	if (origin === 'null') return refuse('null-origin', 'a null origin');
	if (origin === new URL(request.url).origin || csrf.allowedOrigins.has(origin))
		return undefined;
	return permits(request, csrf, websocket)
		? undefined
		: refuse('cross-origin', origin);
}

/**
 * The refusal to send: the default 403, or what `onRefused` answers. Only an `onRefused`
 * that returns a promise gives a promise; anything but a `Response` falls back to the 403.
 */
function refusalOf(
	request: Request,
	csrf: ResolvedCsrf,
	websocket: boolean,
	reason: OriginRefusalReason,
	from: string,
): Response | Promise<Response> {
	const fallback = () =>
		forbidden(
			request,
			`Cross-origin request refused from ${from}.`,
			'FORBIDDEN_ORIGIN',
			FIX,
		);
	const settle = (answer: unknown): Response =>
		answer instanceof Response ? noStore(answer) : fallback();
	if (!csrf.onRefused) return fallback();
	const answer = csrf.onRefused(request, { reason, websocket });
	return answer instanceof Promise ? answer.then(settle) : settle(answer);
}

/** `response` with `cache-control: no-store` added when it sets no `cache-control` (a refusal is never cached). */
function noStore(response: Response): Response {
	if (response.headers.has('cache-control')) return response;
	const headers = new Headers(response.headers);
	headers.set('cache-control', 'no-store');
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

/** `Sec-Fetch-Site` says a browser sent the request from another site (`same-origin` and `none` are fine). */
function crossSite(request: Request): boolean {
	const site = request.headers.get('sec-fetch-site');
	return site === 'cross-site' || site === 'same-site';
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
