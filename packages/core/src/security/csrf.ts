import type { ResolvedCsrf } from './options';
import { forbidden } from './refuse';

const SIMPLE_TYPES = new Set([
	'text/plain',
	'application/x-www-form-urlencoded',
	'multipart/form-data',
]);

/**
 * Whether a browser can send `request` cross-site without a CORS preflight: a
 * GET, HEAD or POST whose `Content-Type` is absent, `text/plain`, a form or multipart.
 */
export function isSimpleRequest(request: Request): boolean {
	const { method } = request;
	if (method !== 'GET' && method !== 'HEAD' && method !== 'POST') return false;
	const type = request.headers.get('content-type');
	if (type === null) return true;
	const media = (type.split(';')[0] ?? '').trim().toLowerCase();
	return media === '' || SIMPLE_TYPES.has(media);
}

/** Whether `request` carries a non-empty CSRF header (a custom header forces a preflight). */
export function hasCsrfHeader(
	request: Request,
	headers: readonly string[],
): boolean {
	return headers.some((name) => (request.headers.get(name) ?? '') !== '');
}

/** The 403 for a simple request without a CSRF header, or `undefined` when it may go on. */
export function checkCsrfHeader(
	request: Request,
	csrf: ResolvedCsrf,
): Response | undefined {
	const { headers } = csrf;
	if (headers === false || !isSimpleRequest(request)) return undefined;
	if (hasCsrfHeader(request, headers)) return undefined;
	return forbidden(
		request,
		`This request requires one of the headers ${headers.join(', ')} (CSRF prevention).`,
		'CSRF_HEADER_REQUIRED',
		`Send one of these headers with any non-empty value (for example "${headers[0]}: 1"), or set csrf: { requireHeader: false } if the server is not reachable from a browser.`,
	);
}
