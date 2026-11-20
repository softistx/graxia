import type { Runtime } from '../server/runtime';
import { checkCsrfHeader } from './csrf';
import { checkOrigin } from './origin';

/**
 * The built-in refusal of an HTTP request (the `Origin` check, then the CSRF
 * header unless a plugin exempted the request), before any plugin sees it; `undefined` when it may go on.
 */
export function checkRequest(
	rt: Runtime,
	request: Request,
	csrfExempt = false,
): Response | Promise<Response> | undefined {
	const { csrf } = rt.options;
	if (csrf === false) return undefined;
	return (
		checkOrigin(request, csrf, false) ??
		(csrfExempt ? undefined : checkCsrfHeader(request, csrf))
	);
}

/**
 * The CSRF header refusal of a request a plugin exempted (`csrfExempt`), owed
 * when no plugin answered it: it must not reach the dispatch.
 */
export function exemptRefusal(
	rt: Runtime,
	request: Request,
): Response | undefined {
	const { csrf } = rt.options;
	return csrf === false ? undefined : checkCsrfHeader(request, csrf);
}

/** The refusal of a WebSocket upgrade by its `Origin`, or `undefined`. */
export function checkUpgrade(
	rt: Runtime,
	request: Request,
): Response | Promise<Response> | undefined {
	const { csrf } = rt.options;
	return csrf === false ? undefined : checkOrigin(request, csrf, true);
}
