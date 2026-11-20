import type { Empty, GraxiaPlugin } from './types';

/**
 * Defines a plugin with typed context. Two forms:
 *
 * - **Direct**, `definePlugin({ ... })`, for a plugin that requires nothing from
 *   the context. `Added` is inferred from `onContext`'s return value.
 * - **Curried**, `definePlugin<In>()({ ... })`, for a plugin that requires `In`
 *   from the context. TypeScript cannot take `In` explicitly and infer `Added`
 *   in one call (no partial type-argument inference), hence the two calls.
 *
 * @example Direct, no requirement
 * const tenant = definePlugin({
 *   name: "tenant",
 *   onContext: () => ({ tenant: "acme" }),
 * });
 *
 * @example Curried, requires `request`
 * const auth = definePlugin<{ request: Request }>()({
 *   name: "auth",
 *   onContext: async ({ context }) => ({ user: { agent: context.request.headers.get("user-agent") } }),
 * });
 *
 * The direct form takes no type argument: `definePlugin<{ request: Request }>({ ... })`
 * is refused, since it would claim the plugin adds `request`. Use the curried form.
 */
export function definePlugin<
	_NoTypeArgument extends never = never,
	Added extends object = Empty,
	const Name extends string = string,
>(plugin: GraxiaPlugin<Empty, Added, Name>): GraxiaPlugin<Empty, Added, Name>;
export function definePlugin<In = Empty>(): <
	Added extends object = Empty,
	const Name extends string = string,
>(
	plugin: GraxiaPlugin<In, Added, Name>,
) => GraxiaPlugin<In, Added, Name>;
export function definePlugin(plugin?: GraxiaPlugin<unknown, object, string>) {
	return plugin === undefined
		? (p: GraxiaPlugin<unknown, object, string>) => p
		: plugin;
}

/** What one plugin adds to the context. */
export type PluginContext<P> = P extends { readonly '~added'?: infer A }
	? NonNullable<A>
	: Empty;

/** What one plugin requires from the context. */
export type PluginRequires<P> = P extends { readonly '~ctx'?: infer C }
	? NonNullable<C>
	: Empty;

/** The intersection of everything a tuple of plugins adds to the context. Tuples only: pass `[a, b]`, not `Plugin[]`. */
export type ContextOf<Plugins extends readonly unknown[]> =
	Plugins extends readonly [infer Head, ...infer Tail]
		? PluginContext<Head> & ContextOf<Tail>
		: unknown;

/** @internal True for `any`: an untyped plugin's context says nothing, so it is skipped, never trusted. */
export type IsAny<T> = 0 extends 1 & T ? true : false;

/** @internal The keys `Req` demands (not optional) that `Available` does not have at all. */
export type AbsentKeys<Req, Available> = {
	[K in keyof Req]-?: Empty extends Pick<Req, K>
		? never
		: K extends keyof Available
			? never
			: K;
}[keyof Req];

/** @internal The keys both have, whose type in `Available` does not fit `Req` (an optional key also accepts `undefined`). */
export type MistypedKeys<Req, Available> = {
	[K in keyof Req]-?: K extends keyof Available
		? [Available[K]] extends [
				Required<Req>[K] | (Empty extends Pick<Req, K> ? undefined : never),
			]
			? never
			: K
		: never;
}[keyof Req];

/** @internal The keys of `Req` that `Available` fails to meet: absent (and required) or of another type. Never for `any`. */
export type UnmetKeys<Req, Available> =
	IsAny<Req> extends true
		? never
		: AbsentKeys<Req, Available> | MistypedKeys<Req, Available>;

/**
 * Tuples only. Resolves to `Plugins` when the host context (plus what earlier plugins add)
 * satisfies every plugin's requirement, and to `never` otherwise. An optional required key
 * may be absent; an untyped (`any`) plugin requires and adds nothing the check trusts.
 */
export type RequiresContext<
	Plugins extends readonly unknown[],
	HostCtx,
> = Plugins extends readonly [infer Head, ...infer Tail]
	? [UnmetKeys<PluginRequires<Head>, HostCtx>] extends [never]
		? Tail extends readonly unknown[]
			? RequiresContext<
					Tail,
					IsAny<PluginContext<Head>> extends true
						? HostCtx
						: HostCtx & PluginContext<Head>
				> extends never
				? never
				: Plugins
			: Plugins
		: never
	: Plugins;
