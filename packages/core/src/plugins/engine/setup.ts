import { GraxiaPluginError } from '../../errors/plugin-error';
import type { GraxiaPlugin } from '../types';

/**
 * Creates the memoized `init`: runs each plugin's `setup` once, in order,
 * awaited. A throwing `setup` is wrapped in `GraxiaPluginError`
 * and stops the sequence: the plugins after it never ran `setup`.
 */
export function createSetup(
	ordered: readonly GraxiaPlugin<any, any>[],
	names: readonly string[],
	/** Receives each plugin whose `setup` completed (a plugin without `setup` counts). */
	ready: Set<GraxiaPlugin<any, any>>,
): () => Promise<void> {
	let initialised: Promise<void> | undefined;
	return () => {
		initialised ??= (async () => {
			for (const plugin of ordered) {
				try {
					await plugin.setup?.({ plugins: names });
					ready.add(plugin);
				} catch (error) {
					throw new GraxiaPluginError(plugin.name, error);
				}
			}
		})();
		return initialised;
	};
}
