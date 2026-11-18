import { requestIdKey } from '../http/request-id';
import { errorBody, jsonResponse } from '../http/respond';
import type { RequestState } from '../plugins/state';

/** The message every unexpected failure answers with. */
export const UNEXPECTED_MESSAGE = 'Unexpected error.';

/** The generic body of an unexpected failure. */
export const UNEXPECTED_BODY = errorBody(UNEXPECTED_MESSAGE);

/** Receives the original, unmasked error of an unexpected failure. */
export type OnUnexpected = (
	error: unknown,
	info: { requestId: string | undefined },
) => void;

/** What the transport uses to report and answer an unexpected failure. */
export interface UnexpectedHandler {
	/** Hands the original error to `onUnexpected`; never throws. */
	report(error: unknown, state: RequestState): void;
	/** Reports, then answers the generic 500. */
	respond(error: unknown, state: RequestState): Response;
}

const logToConsole: OnUnexpected = (error, { requestId }) =>
	console.error(`[graxia] unexpected error (request ${requestId})`, error);

/**
 * The single place an unexpected failure (a plugin hook that threw, a thrown
 * `execute`, a failing `context`) is turned into a response: a generic 500
 * that says nothing about the cause. The original error stays reachable
 * through `onUnexpected` (by default `console.error`, off when
 * `NODE_ENV=production`); masking and correlation ids arrive with the
 * error-handling slice.
 */
export function createUnexpectedHandler(
	onUnexpected?: OnUnexpected | false,
): UnexpectedHandler {
	const sink =
		onUnexpected === false
			? undefined
			: (onUnexpected ??
				(process.env['NODE_ENV'] === 'production' ? undefined : logToConsole));
	const report = (error: unknown, state: RequestState) => {
		try {
			sink?.(error, { requestId: state.get(requestIdKey) });
		} catch {
			// A failing reporter must not turn into a second failure.
		}
	};
	return {
		report,
		respond(error, state) {
			report(error, state);
			return jsonResponse(UNEXPECTED_BODY, 500, 'application/json');
		},
	};
}
