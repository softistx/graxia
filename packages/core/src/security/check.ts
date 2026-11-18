import type { Runtime } from '../server/runtime';
import { checkCsrfHeader } from './csrf';
import { checkOrigin } from './origin';

/**
 * The built-in refusal of an HTTP request (the `Origin` check, then the CSRF
 * header), before any plugin sees it; `undefined` when it may go on.
 */
export function checkRequest(
	rt: Runtime,
	request: Request,
): Response | undefined {
	const { csrf } = rt.options;
	if (csrf === false) return undefined;
	return checkOrigin(request, csrf, false) ?? checkCsrfHeader(request, csrf);
}

/** The refusal of a WebSocket upgrade by its `Origin`, or `undefined`. */
export function checkUpgrade(
	rt: Runtime,
	request: Request,
): Response | undefined {
	const { csrf } = rt.options;
	return csrf === false ? undefined : checkOrigin(request, csrf, true);
}
