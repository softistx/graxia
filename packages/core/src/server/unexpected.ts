import { errorBody, jsonResponse } from '../http/respond';

/** The message every unexpected failure answers with. */
export const UNEXPECTED_MESSAGE = 'Unexpected error.';

/**
 * The single place an unexpected failure (a plugin hook that threw, a thrown
 * `execute`, a failing `context`) is turned into a response: a generic 500 that
 * says nothing about the cause. `error` is the original, unmasked value; it is
 * kept reachable here for error reporting (masking and correlation ids
 * arrive with the error-handling slice).
 */
export function handleUnexpected(_error: unknown): Response {
	return jsonResponse(errorBody(UNEXPECTED_MESSAGE), 500, 'application/json');
}
