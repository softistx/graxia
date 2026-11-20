import type {
	AbsentKeys,
	IsAny,
	MistypedKeys,
	PluginContext,
	PluginRequires,
	UnmetKeys,
} from './define';

type UnionToIntersection<U> = (
	U extends unknown
		? (arg: U) => void
		: never
) extends (arg: infer I) => void
	? I
	: never;

type LastOf<U> =
	UnionToIntersection<U extends unknown ? () => U : never> extends () => infer L
		? L
		: never;

/** One key as text: `context.k` for a string or number key, a fixed label for a symbol. */
type Field<K> = [K] extends [symbol]
	? 'a symbol-keyed field'
	: `context.${K & (string | number)}`;

/** `"a" | "b"` becomes `"context.a, context.b"`: one string, so no field is cut from the message. */
type ContextFields<Keys, Last = LastOf<Keys>> = [Keys] extends [never]
	? ''
	: [Exclude<Keys, Last>] extends [never]
		? Field<Last>
		: `${ContextFields<Exclude<Keys, Last>>}, ${Field<Last>}`;

/** `"auth"` for a literal name, `plugin at index N` for a plain `string`. */
type Label<Name extends string, Index extends unknown[]> = string extends Name
	? `at index ${Index['length']}`
	: `"${Name}"`;

type Message<
	Plugin,
	Index extends unknown[],
	Required,
	Available,
	Name extends string = Plugin extends { readonly name: infer N extends string }
		? N
		: string,
> = [AbsentKeys<Required, Available>] extends [never]
	? `graxia: plugin ${Label<Name, Index>} needs ${ContextFields<MistypedKeys<Required, Available>>}, which the context provides as another type`
	: `graxia: plugin ${Label<Name, Index>} needs ${ContextFields<AbsentKeys<Required, Available>>}, which nothing provides (the factory's result, ContextInit<Host> on its init, createGraxia<Host>()(...), or an earlier plugin)`;

/** The first plugin of the tuple whose requirement `Available` (plus what earlier plugins add) does not meet, as a message; `never` when all are met. */
type FirstUnmet<
	Plugins extends readonly unknown[],
	Available,
	Index extends unknown[] = [],
> = Plugins extends readonly [infer Head, ...infer Tail]
	? [UnmetKeys<PluginRequires<Head>, Available>] extends [never]
		? FirstUnmet<
				Tail,
				IsAny<PluginContext<Head>> extends true
					? Available
					: Available & PluginContext<Head>,
				[...Index, unknown]
			>
		: Message<Head, Index, PluginRequires<Head>, Available>
	: never;

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
		: [FirstUnmet<Plugins, Available>] extends [never]
			? unknown
			: {
					plugins: {
						readonly [M in FirstUnmet<Plugins, Available>]: never;
					};
				};
