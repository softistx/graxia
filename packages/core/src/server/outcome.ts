import { type ExecutionResult, GraphQLError } from 'graphql';
import { NO_AFTER, type StageOutcome } from '../plugins/stage';
import type { HttpRefusal } from './http-refusal';

/** How one operation ended, before it is encoded as a response. */
export type Outcome =
	| {
			kind: 'result';
			result: ExecutionResult;
			/** Overrides the status the negotiated media type would give. */
			status?: number;
			headers?: HeadersInit;
			/** What a plugin asked of the plain JSON response (not of a batch entry, SSE or WebSocket). */
			refusal?: HttpRefusal;
			/** The operation's `getContext()` scope, set once its context exists (not for a failure before it). */
			scope?: <T>(work: () => T) => T;
	  }
	| { kind: 'response'; response: Response }
	| {
			/** A subscription: results to stream, and how to end and scope them. */
			kind: 'stream';
			/** A subscription ends gracefully when `dispose()` starts; an incremental query drains first. */
			subscription: boolean;
			source: AsyncIterator<unknown>;
			/** Aborts the operation's signal; ends the source. */
			stop: AbortController;
			/** Runs a pull of `source` in the operation's `getContext()` scope. */
			scope<T>(work: () => T): T;
	  }
	| { kind: 'unexpected'; error: unknown };

/** A result made of one error that failed before execution. */
export function failure(
	message: string,
	options: {
		status?: number;
		headers?: HeadersInit;
		code?: string;
		/** What the client changes to fix the error; always set. */
		fix: string;
	},
): Outcome {
	return {
		kind: 'result',
		result: {
			errors: [
				new GraphQLError(message, {
					extensions: {
						...(options.code ? { code: options.code } : {}),
						fix: options.fix,
					},
				}),
			],
		},
		...(options.status !== undefined ? { status: options.status } : {}),
		...(options.headers ? { headers: options.headers } : {}),
	};
}

/** Result of a document step that failed with GraphQL errors. */
export function failed(errors: readonly GraphQLError[]): Outcome {
	return { kind: 'result', result: { errors } };
}

/** An unexpected failure (see `handleUnexpected`). */
export function unexpected(error: unknown): Outcome {
	return { kind: 'unexpected', error };
}

/**
 * Unwinds a stage's after-hooks and returns the error to report: the hook's
 * own error when it threw, else the one an after-hook threw.
 */
export function settle<Done>(
	stage: StageOutcome<unknown, Done>,
	done: Done,
): unknown | Promise<unknown> {
	return stage.runAfter === NO_AFTER ? stage.error : settleAfter(stage, done);
}

async function settleAfter<Done>(
	stage: StageOutcome<unknown, Done>,
	done: Done,
): Promise<unknown> {
	try {
		await stage.runAfter(done);
	} catch (error) {
		return stage.error ?? error;
	}
	return stage.error;
}
