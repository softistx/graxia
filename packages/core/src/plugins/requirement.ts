import type { PluginContext, PluginRequires, RequiresContext } from './define';

/** The keys `Required` asks for that `Available` lacks, or provides with a type that does not fit. */
type MissingKeys<Required, Available> = {
	[K in keyof Required]-?: K extends keyof Available
		? [Available[K]] extends [Required[K]]
			? never
			: K
		: K;
}[keyof Required] &
	string;

type Join<Keys extends string> = [Keys] extends [never]
	? never
	: Keys extends unknown
		? `"${Keys}"`
		: never;

/** An `any`-typed context (an untyped plugin) says nothing: it is skipped, not trusted. */
type IsAny<T> = 0 extends 1 & T ? true : false;

/** The first plugin of the tuple whose requirement `Available` (plus what earlier plugins add) does not meet, as a message. */
type FirstUnmet<
	Plugins extends readonly unknown[],
	Available,
> = Plugins extends readonly [infer Head, ...infer Tail]
	? [Available] extends [PluginRequires<Head>]
		? FirstUnmet<
				Tail,
				IsAny<PluginContext<Head>> extends true
					? Available
					: Available & PluginContext<Head>
			>
		: UnmetMessage<
				Head extends { readonly name: infer N extends string } ? N : string,
				MissingKeys<PluginRequires<Head>, Available>
			>
	: never;

type UnmetMessage<
	Name extends string,
	Keys extends string,
> = `graxia: plugin "${Name}" requires the context field ${UnionToList<Keys>}, which the host context does not provide. Add it to the context factory, to the serverContext type of createGraxia<HostCtx>, or to a plugin listed before it.`;

type UnionToList<Keys extends string> =
	Join<Keys> extends infer J extends string ? J : never;

/**
 * The part of the `createGraxia` options that checks every plugin's required
 * context (`definePlugin<In>()`) against what the host provides. `unknown` when
 * all are met, when the plugin list is not a tuple, or when none was given; else
 * a `plugins` entry whose missing property holds the message.
 */
export type RequirePluginContext<
	Plugins extends readonly unknown[],
	Available,
> = '~none' extends keyof Plugins
	? unknown
	: number extends Plugins['length']
		? unknown
		: [RequiresContext<Plugins, Available>] extends [never]
			? {
					plugins: {
						readonly [M in FirstUnmet<Plugins, Available>]: never;
					};
				}
			: unknown;
