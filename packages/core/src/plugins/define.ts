import type { Empty, GraxiaPlugin } from './types';

/**
 * Defines a plugin with typed context. Curried so `Added` is inferred from
 * `onContext`'s return value; `In` is the context the plugin requires.
 *
 * @example
 * const auth = definePlugin<{ request: Request }>()({
 *   name: "auth",
 *   onContext: async () => ({ user: { id: "1" } }),
 * });
 */
export function definePlugin<In = Empty>() {
	return <Added extends object = Empty>(
		plugin: GraxiaPlugin<In, Added>,
	): GraxiaPlugin<In, Added> => plugin;
}

/** What one plugin adds to the context. */
export type PluginContext<P> = P extends { readonly '~added'?: infer A }
	? NonNullable<A>
	: Empty;

/** What one plugin requires from the context. */
export type PluginRequires<P> = P extends { readonly '~ctx'?: infer C }
	? NonNullable<C>
	: Empty;

/** The intersection of everything a tuple of plugins adds to the context. */
export type ContextOf<Plugins extends readonly unknown[]> =
	Plugins extends readonly [infer Head, ...infer Tail]
		? PluginContext<Head> & ContextOf<Tail>
		: unknown;

/**
 * Resolves to `Plugins` when the host context (plus what earlier plugins add)
 * satisfies every plugin's requirement, and to `never` otherwise.
 */
export type RequiresContext<
	Plugins extends readonly unknown[],
	HostCtx,
> = Plugins extends readonly [infer Head, ...infer Tail]
	? HostCtx extends PluginRequires<Head>
		? Tail extends readonly unknown[]
			? RequiresContext<Tail, HostCtx & PluginContext<Head>> extends never
				? never
				: Plugins
			: Plugins
		: never
	: Plugins;
