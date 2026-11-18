import { UNEXPECTED_MESSAGE } from '../errors/mask';
import { requestIdKey } from '../http/request-id';
import { jsonResponse } from '../http/respond';
import type { RequestState } from '../plugins/state';
import { unexpectedErrorKey } from './execute-state';

/** Where an unexpected failure happened. */
export type UnexpectedPhase = 'request' | 'execution' | 'dispose';

/** What `onUnexpected` is told about the failure. */
export interface UnexpectedInfo {
	/** The request's id (`x-request-id`); `undefined` for a `dispose` report. */
	requestId: string | undefined;
	/** The id the client got in the body; always equal to `requestId`. */
	correlationId: string | undefined;
	/** `request`: a hook or the transport; `execution`: an operation; `dispose`: shutdown leftovers. */
	phase: UnexpectedPhase;
}

/** Receives the original, unmasked error of an unexpected failure. */
export type OnUnexpected = (error: unknown, info: UnexpectedInfo) => void;

/** What the transport uses to report and answer an unexpected failure. */
export interface UnexpectedHandler {
	/** Hands the original error to `onUnexpected`; never throws. */
	report(error: unknown, state: RequestState, phase?: UnexpectedPhase): void;
	/** Reports, then answers the generic 500. */
	respond(
		error: unknown,
		state: RequestState,
		phase?: UnexpectedPhase,
	): Response;
	/** The generic body of an unexpected failure, carrying the correlation id. */
	body(state: RequestState): { errors: unknown[] };
}

const logToConsole: OnUnexpected = (error, { correlationId, phase }) =>
	console.error(
		`[graxia] unexpected error (${phase}, request ${correlationId})`,
		error,
	);

/**
 * The single place an unexpected failure (a plugin hook that threw, a thrown
 * `execute`, a failing `context`) is turned into a response: a generic 500
 * with `INTERNAL_SERVER_ERROR` and the correlation id (the request id), that
 * says nothing about the cause. The original error stays reachable through
 * `onUnexpected` (by default `console.error`, off when
 * `NODE_ENV=production`), with the same id.
 */
export function createUnexpectedHandler(
	onUnexpected?: OnUnexpected | false,
): UnexpectedHandler {
	const sink =
		onUnexpected === false
			? undefined
			: (onUnexpected ??
				(process.env['NODE_ENV'] === 'production' ? undefined : logToConsole));
	const report = (
		error: unknown,
		state: RequestState,
		phase: UnexpectedPhase = 'request',
	) => {
		const id = state.get(requestIdKey);
		if (state.get(unexpectedErrorKey) === undefined)
			state.set(unexpectedErrorKey, { error });
		try {
			sink?.(error, { requestId: id, correlationId: id, phase });
		} catch {
			// A failing reporter must not turn into a second failure.
		}
	};
	const body = (state: RequestState) => {
		const correlationId = state.get(requestIdKey);
		return {
			errors: [
				{
					message: UNEXPECTED_MESSAGE,
					extensions: {
						code: 'INTERNAL_SERVER_ERROR',
						...(correlationId !== undefined ? { correlationId } : {}),
					},
				},
			],
		};
	};
	return {
		report,
		body,
		respond(error, state, phase) {
			report(error, state, phase);
			return jsonResponse(body(state), 500, 'application/json');
		},
	};
}
