import { createStateKey, type RequestState } from '../plugins/state';

/**
 * @internal Request state key holding the request's id. Graxia generates it;
 * a client's `x-request-id` is never trusted nor echoed. Not exported from the
 * package: plugins read the id with {@link getRequestId} and cannot write it.
 */
export const requestIdKey = createStateKey<string>('request-id');

/**
 * The id of the request (the `x-request-id` response header and the
 * `correlationId` of masked errors), or `undefined` outside a request.
 *
 * @example
 * onRequest: ({ state }) => console.log('request', getRequestId(state)),
 */
export function getRequestId(state: RequestState): string | undefined {
	return state.get(requestIdKey);
}

/** Name of the response header carrying the request id. */
export const REQUEST_ID_HEADER = 'x-request-id';

/** A fresh request id (a v4 UUID). */
export function createRequestId(): string {
	return crypto.randomUUID();
}
