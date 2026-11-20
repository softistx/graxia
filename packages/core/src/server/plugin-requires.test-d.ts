import { definePlugin } from '../plugins/define';
import type { RequirePluginContext } from '../plugins/requirement';
import type { GraxiaPlugin } from '../plugins/types';
import { createGraxia } from './create-graxia';
import { schema } from './fixtures.test-util';
import type { CoreContext } from './infer-context';
import type { ContextInit } from './options';

const auth = definePlugin<{ request: Request }>()({
	name: 'auth',
	onContext: ({ context }) => ({ agent: context.request.url }),
});
const needsAgent = definePlugin<{ agent: string }>()({
	name: 'needs-agent',
	onContext: () => ({}),
});
const needsDb = definePlugin<{ db: string }>()({
	name: 'needs-db',
	onContext: () => ({}),
});
const bare = definePlugin({ name: 'bare', onContext: () => ({ a: 1 }) });
const bareHook = definePlugin()({ name: 'bare-hook' });
const untyped: GraxiaPlugin<any, any> = { name: 'untyped' };

// the host context type, declared on the factory's `init` (as `serverContext`)
const withRequest = (_init: ContextInit<{ request: Request }>) => ({});
// provided by the host context type
createGraxia({ schema, context: withRequest, plugins: [auth] });
// provided by the context factory
createGraxia({
	schema,
	context: () => ({ db: 'x' }),
	plugins: [needsDb],
});
// added by an earlier plugin and consumed by a later one
createGraxia({ schema, context: withRequest, plugins: [auth, needsAgent] });
// no requirement, no `In`, untyped, none given
createGraxia({ schema, plugins: [bare, bareHook, untyped] });
createGraxia({
	schema,
	plugins: [untyped, needsDb],
	context: () => ({ db: 'x' }),
});
createGraxia({ schema });

// @ts-expect-error `request` is not in the host context
createGraxia({ schema, plugins: [auth] });
// @ts-expect-error `db` is missing, `request` is there
createGraxia({ schema, context: withRequest, plugins: [auth, needsDb] });
// @ts-expect-error `agent` is added by `auth`, which comes after
createGraxia({ schema, context: withRequest, plugins: [needsAgent, auth] });
// @ts-expect-error wrong type for `db`
createGraxia({ schema, context: () => ({ db: 1 }), plugins: [needsDb] });

// an untyped plugin skips itself only: the plugins after it are still checked
// @ts-expect-error `db` is provided by nothing
createGraxia({ schema, plugins: [untyped, needsDb] });

// two missing fields, both named (one key)
const needsTwo = definePlugin<{ a: string; b: number }>()({
	name: 'needs-two',
});
// @ts-expect-error `a` and `b` are provided by nothing
createGraxia({ schema, plugins: [needsTwo] });

// a const tuple declared outside the call is still checked
const declared = [needsDb] as const;
// @ts-expect-error `db` is provided by nothing
createGraxia({ schema, plugins: declared });

// an optional requirement may be absent; if present it must fit
const optionalDb = definePlugin<{ db?: string }>()({ name: 'optional-db' });
createGraxia({ schema, plugins: [optionalDb] });
createGraxia({ schema, context: () => ({ db: 'x' }), plugins: [optionalDb] });
// @ts-expect-error `db` is provided as a number
createGraxia({ schema, context: () => ({ db: 1 }), plugins: [optionalDb] });

// a plugin whose name is a plain `string` is quoted by position (index 1)
declare function dbPlugin(): GraxiaPlugin<{ db: string }>;
// @ts-expect-error `db` is provided by nothing
createGraxia({ schema, plugins: [bare, dbPlugin()] });

// the documented skips: an explicit `createGraxia<Host>` and a non-tuple array
createGraxia<{ x: string }>({ schema, plugins: [needsDb] });
declare const list: GraxiaPlugin<{ db: string }>[];
createGraxia({ schema, plugins: list });

// the message, pinned
type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
		? true
		: false;
const assertType = <_T extends true>() => {};
assertType<
	Equal<
		RequirePluginContext<[typeof auth], CoreContext>,
		{
			plugins: {
				readonly 'graxia: plugin "auth" needs context.request, which nothing provides (the factory\'s result, ContextInit<Host> on its init, or an earlier plugin)': never;
			};
		}
	>
>();
assertType<
	Equal<
		RequirePluginContext<[typeof needsTwo], CoreContext> extends {
			plugins: infer P;
		}
			? keyof P
			: never,
		'graxia: plugin "needs-two" needs context.a, context.b, which nothing provides (the factory\'s result, ContextInit<Host> on its init, or an earlier plugin)'
	>
>();

// number and symbol keys are checked too
const needsNumber = definePlugin<{ 0: string }>()({ name: 'needs-number' });
// @ts-expect-error `0` is provided by nothing
createGraxia({ schema, plugins: [needsNumber] });
declare const sym: unique symbol;
const needsSymbol = definePlugin<{ [sym]: string }>()({ name: 'needs-symbol' });
// @ts-expect-error the symbol-keyed field is provided by nothing
createGraxia({ schema, plugins: [needsSymbol] });

// an index signature demands no specific key
const needsAny = definePlugin<Record<string, string>>()({ name: 'needs-any' });
createGraxia({ schema, plugins: [needsAny] });

// the exact text of the other messages
declare function indexed(): GraxiaPlugin<{ db: string }>;
assertType<
	Equal<
		RequirePluginContext<
			[typeof bare, ReturnType<typeof indexed>],
			CoreContext
		>,
		{
			plugins: {
				readonly "graxia: plugin at index 1 needs context.db, which nothing provides (the factory's result, ContextInit<Host> on its init, or an earlier plugin)": never;
			};
		}
	>
>();
assertType<
	Equal<
		RequirePluginContext<[typeof needsNumber], CoreContext>,
		{
			plugins: {
				readonly 'graxia: plugin "needs-number" needs context.0, which nothing provides (the factory\'s result, ContextInit<Host> on its init, or an earlier plugin)': never;
			};
		}
	>
>();
assertType<
	Equal<
		RequirePluginContext<[typeof needsSymbol], CoreContext>,
		{
			plugins: {
				readonly 'graxia: plugin "needs-symbol" needs a symbol-keyed field, which nothing provides (the factory\'s result, ContextInit<Host> on its init, or an earlier plugin)': never;
			};
		}
	>
>();
