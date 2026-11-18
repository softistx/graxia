/**
 * Thrown when graxia is configured wrongly (duplicate plugin name, invalid
 * `onContext` return, missing state key). Always a programming error, never a
 * client error.
 */
export class GraxiaConfigError extends Error {
	/** Stable machine-readable code. */
	readonly code = 'GRAXIA_CONFIG' as const;

	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = 'GraxiaConfigError';
	}
}
