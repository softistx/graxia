import { GraxiaConfigError } from '../errors/config-error';
import type { GraxiaPlugin } from './types';

/**
 * Orders plugins: `enforce: "pre"` first, then the others, then `"post"`.
 * The sort is stable (declaration order is kept inside a group). Two plugins
 * with the same `name` throw a {@link GraxiaConfigError} naming both indexes.
 */
export function orderPlugins<P extends Pick<GraxiaPlugin, 'name' | 'enforce'>>(
	plugins: readonly P[],
): P[] {
	const seen = new Map<string, number>();
	plugins.forEach((plugin, index) => {
		const first = seen.get(plugin.name);
		if (first !== undefined) {
			throw new GraxiaConfigError(
				`Duplicate plugin name "${plugin.name}" at indexes ${first} and ${index}`,
			);
		}
		seen.set(plugin.name, index);
	});
	const rank = (p: P) =>
		p.enforce === 'pre' ? 0 : p.enforce === 'post' ? 2 : 1;
	return plugins
		.map((plugin, index) => ({ plugin, index }))
		.sort((a, b) => rank(a.plugin) - rank(b.plugin) || a.index - b.index)
		.map((entry) => entry.plugin);
}
