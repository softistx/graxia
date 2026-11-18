import type { GraxiaPlugin } from '../types';

/**
 * Creates the memoized `dispose`: runs each plugin's `onDispose` once, in
 * reverse plugin order, every one even when an earlier one throws; the first
 * error is rethrown after all ran.
 */
export function createDispose(
	ordered: readonly GraxiaPlugin<any, any>[],
): () => Promise<void> {
	let disposed: Promise<void> | undefined;
	return () => {
		disposed ??= (async () => {
			let first: unknown;
			let failed = false;
			for (let i = ordered.length - 1; i >= 0; i--) {
				try {
					await ordered[i]?.onDispose?.();
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
