import type { GraxiaPlugin } from '../types';

/**
 * Creates the memoized `dispose`: runs each plugin's `onDispose` once, in
 * reverse plugin order, every one (of the plugins whose `setup` completed) even when an earlier one throws; the first
 * error is rethrown after all ran.
 */
export function createDispose(
	ordered: readonly GraxiaPlugin<any, any>[],
	/** The plugins whose `setup` completed: only those are disposed. */
	ready: ReadonlySet<GraxiaPlugin<any, any>>,
): () => Promise<void> {
	let disposed: Promise<void> | undefined;
	return () => {
		disposed ??= (async () => {
			let first: unknown;
			let failed = false;
			for (let i = ordered.length - 1; i >= 0; i--) {
				const plugin = ordered[i];
				if (!plugin || !ready.has(plugin)) continue;
				try {
					await plugin.onDispose?.();
				} catch (error) {
					if (!failed) first = error;
					failed = true;
				}
			}
			if (failed) throw first;
		})();
		return disposed;
	};
}
