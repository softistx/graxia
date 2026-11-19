import { orderPlugins } from '../order';
import type { GraxiaPlugin, HookStage, SetupApi } from '../types';
import { createDispose } from './dispose';
import type { PluginRunners } from './outputs';
import { createSetup } from './setup';
import { buildRunners } from './stages';

export type {
	ChunkOut,
	ContextOut,
	ExecuteOut,
	ParamsOut,
	ParseOut,
	PluginRunners,
	RequestOut,
	ResponseOut,
	ValidateOut,
} from './outputs';

/** The plugin engine: ordered plugins, one runner per stage, one-time `init`. */
export interface PluginEngine {
	/** Plugin names in execution order. */
	readonly names: readonly string[];
	/** Whether any plugin defines the stage (lets a transport skip it entirely). */
	has(stage: HookStage): boolean;
	/** Runs every plugin's `setup` once, awaited; later calls return the same promise. */
	init(): Promise<void>;
	/** Runs every plugin's `onDispose` once, in reverse plugin order; later calls return the same promise. */
	dispose(): Promise<void>;
	/**
	 * Whether a plugin's `csrfExempt` accepts this `GET` request. A throwing
	 * predicate counts as `false` and is handed to `onError`.
	 */
	csrfExempt(request: Request, onError: (error: unknown) => void): boolean;
	/** The stage runners (see {@link PluginRunners}). */
	readonly runners: PluginRunners;
}

/**
 * Creates the plugin engine over `plugins`: orders them (see `orderPlugins`),
 * and builds a runner per stage. A throwing hook does not reject its stage:
 * the outcome carries the original `error` (see {@link PluginRunners}); only
 * `setup` errors are wrapped (in `GraxiaPluginError`).
 *
 * `plugins` is `GraxiaPlugin<any, any>[]` on purpose: plugins of every
 * context shape share one list, so the typed context stops at this boundary.
 */
export function createPluginEngine(
	plugins: readonly GraxiaPlugin<any, any>[],
	/** What `setup` sees as `api.transports`. Default: both on, as an instance without options. */
	transports: SetupApi['transports'] = { sse: true, ws: true },
): PluginEngine {
	const ordered = orderPlugins(plugins);
	const names = ordered.map((p) => p.name);
	const hooksOf = (stage: HookStage) =>
		ordered.flatMap((plugin) => {
			const fn = plugin[stage] as ((p: never) => never) | undefined;
			return fn ? [{ plugin: plugin.name, run: fn.bind(plugin) }] : [];
		});
	const ready = new Set<GraxiaPlugin<any, any>>();
	return {
		names,
		runners: buildRunners(hooksOf),
		csrfExempt: (request, onError) =>
			request.method === 'GET' &&
			ordered.some((plugin) => {
				if (typeof plugin.csrfExempt !== 'function') return false;
				try {
					return plugin.csrfExempt(request) === true;
				} catch (error) {
					onError(error);
					return false;
				}
			}),
		has: (stage) => ordered.some((p) => typeof p[stage] === 'function'),
		init: createSetup(ordered, names, ready, transports),
		dispose: createDispose(ordered, ready),
	};
}
