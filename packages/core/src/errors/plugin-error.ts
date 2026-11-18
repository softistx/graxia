import { GraxiaConfigError } from './config-error';

/**
 * Wraps an error thrown by a plugin's `setup` so the failing plugin is named.
 * The original error is kept as `cause`.
 */
export class GraxiaPluginError extends GraxiaConfigError {
	/** Name of the plugin whose `setup` threw. */
	readonly plugin: string;

	constructor(plugin: string, cause: unknown) {
		const reason = cause instanceof Error ? cause.message : String(cause);
		super(`Plugin "${plugin}" failed during setup: ${reason}`, { cause });
		this.name = 'GraxiaPluginError';
		this.plugin = plugin;
	}
}
