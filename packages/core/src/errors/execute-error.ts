/**
 * Thrown by `graxia.execute` when the request did not end in an execution
 * result: a plugin answered with `respond(...)`, the server is shutting down,
 * or something failed unexpectedly (a 500). `response` is what HTTP would
 * have sent. `cause` holds the original error of an unexpected failure (the
 * 500 path) when there is one; it is never serialized into a response.
 */
export class GraxiaExecuteError extends Error {
	/** Stable machine-readable code. */
	readonly code = 'GRAXIA_EXECUTE' as const;
	/** The HTTP response the pipeline produced instead of a result. */
	readonly response: Response;

	constructor(message: string, response: Response, options?: ErrorOptions) {
		super(message, options);
		this.name = 'GraxiaExecuteError';
		this.response = response;
	}

	/** The HTTP status of {@link GraxiaExecuteError.response}. */
	get status(): number {
		return this.response.status;
	}
}
