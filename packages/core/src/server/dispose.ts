import type { PluginEngine } from '../plugins/engine';
import { RequestState } from '../plugins/state';
import type { Lifecycle } from './lifecycle';
import type { UnexpectedHandler } from './unexpected';

/** @internal What `dispose` needs from the instance. */
export interface DisposeParts {
	lifecycle: Lifecycle;
	engine: PluginEngine;
	/** Resolves once every plugin's `setup` ran (may reject). */
	ready: Promise<void>;
	/** The servers `serve()` started. */
	servers: readonly { stop(): Promise<void> }[];
	unexpected: UnexpectedHandler;
	/** Default drain timeout in milliseconds. */
	timeout: number;
}

/**
 * @internal Builds the idempotent `dispose`: refuse new work, stop the
 * servers, drain (aborting after the timeout, then waiting at most as long
 * again and reporting what is left through `onUnexpected`), wait for `setup`,
 * then run the plugins' `onDispose`.
 */
export function createDispose(
	parts: DisposeParts,
): (options?: { timeout?: number }) => Promise<void> {
	let disposed: Promise<void> | undefined;
	return (options) => {
		disposed ??= (async () => {
			const { lifecycle, engine, servers, unexpected } = parts;
			lifecycle.close();
			const stopped = servers.map((server) => server.stop());
			const left = await lifecycle.drain(options?.timeout ?? parts.timeout);
			if (left > 0)
				unexpected.report(
					new Error(`dispose: ${left} operation(s) did not settle after abort`),
					new RequestState(),
					'dispose',
				);
			await Promise.all(stopped);
			await parts.ready.catch(() => {});
			await engine.dispose();
		})();
		return disposed;
	};
}
