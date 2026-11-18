import { GraxiaPluginError } from '../../errors/plugin-error';
import type { GraxiaPlugin } from '../types';

/**
 * Creates the memoized `init`: runs each plugin's `setup` once, in order,
 * awaited. A throwing `setup` is wrapped in `GraxiaPluginError`.
 */
export function createSetup(
	ordered: readonly GraxiaPlugin<any, any>[],
	names: readonly string[],
): () => Promise<void> {
	let initialised: Promise<void> | undefined;
	return () => {
		initialised ??= (async () => {
			for (const plugin of ordered) {
				try {
					await plugin.setup?.({ plugins: names });
				} catch (error) {
					throw new GraxiaPluginError(plugin.name, error);
				}
			}
		})();
		return initialised;
	};
}
