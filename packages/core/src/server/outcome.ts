import { type ExecutionResult, GraphQLError } from 'graphql';
import type { StageOutcome } from '../plugins/stage';

/** How one operation ended, before it is encoded as a response. */
export type Outcome =
	| {
			kind: 'result';
			result: ExecutionResult;
			/** Overrides the status the negotiated media type would give. */
			status?: number;
			headers?: HeadersInit;
	  }
	| { kind: 'response'; response: Response }
	| { kind: 'unexpected'; error: unknown };

/** A result made of one error that failed before execution. */
export function failure(
	message: string,
	options: { status?: number; headers?: HeadersInit; code?: string } = {},
): Outcome {
	return {
		kind: 'result',
		result: {
			errors: [
				new GraphQLError(message, {
					...(options.code ? { extensions: { code: options.code } } : {}),
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
export async function settle<Done>(
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
