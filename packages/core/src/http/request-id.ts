import { createStateKey } from '../plugins/state';

/**
 * Request state key holding the request's id. Graxia generates it; a client's
 * `x-request-id` is never trusted nor echoed.
 */
export const requestIdKey = createStateKey<string>('request-id');

/** Name of the response header carrying the request id. */
export const REQUEST_ID_HEADER = 'x-request-id';

/** A fresh request id (a v4 UUID). */
export function createRequestId(): string {
	return crypto.randomUUID();
}
