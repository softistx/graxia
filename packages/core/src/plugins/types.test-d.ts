import {
	type ContextOf,
	definePlugin,
	type PluginContext,
	type PluginRequires,
	type RequiresContext,
} from './define';
import { createStateKey, StateBag, type StateKey } from './state';
import type { Empty } from './types';

type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
		? true
		: false;
const assertType = <_T extends true>() => {};

const auth = definePlugin<{ request: Request }>()({
	name: 'auth',
	onContext: async () => ({ user: { id: '1' } }),
});
const tenant = definePlugin({
	name: 'tenant',
	onContext: () => ({ tenant: 'acme' }),
});
const needsUser = definePlugin<{ user: { id: string } }>()({
	name: 'needs-user',
	onContext: ({ context }) => ({ id: context.user.id }),
});

const needsFlag = definePlugin<{ flag: boolean }>()({
	name: 'needs-flag',
	onContext: () => ({}),
});

// inference of what one plugin adds
assertType<Equal<PluginContext<typeof auth>, { user: { id: string } }>>();
// intersection of two plugins
assertType<
	Equal<
		ContextOf<[typeof auth, typeof tenant]>,
		{ user: { id: string } } & { tenant: string }
	>
>();
// later hooks see the added context
definePlugin<{ request: Request }>()({
	name: 'later',
	onContext: () => ({ a: 1 }),
	onExecute: ({ args }) => {
		assertType<Equal<typeof args.contextValue.a, number>>();
		assertType<Equal<typeof args.contextValue.request, Request>>();
	},
});

// a plugin whose requirement the host does not provide
const ok: RequiresContext<[typeof needsUser], { user: { id: string } }> = [
	needsUser,
];
// @ts-expect-error the host context lacks `user`
const missing: RequiresContext<[typeof needsUser], Record<never, never>> = [
	needsUser,
];
// the requirement can come from an earlier plugin
const chained: RequiresContext<
	[typeof auth, typeof needsUser],
	{ request: Request }
> = [auth, needsUser];

// onContext must return an object
// @ts-expect-error a string cannot be merged into the context
definePlugin({ name: 'bad', onContext: () => 'x' });

// state keys are typed
const key: StateKey<number> = createStateKey<number>('n');
const state = new StateBag();
state.set(key, 1);
assertType<Equal<ReturnType<typeof state.get<number>>, number | undefined>>();
// @ts-expect-error a string is not a number
state.set(key, '1');

// a chained requirement that no earlier plugin satisfies
// @ts-expect-error `user` is added only after `needsUser` runs
const unmet: RequiresContext<
	[typeof needsUser, typeof auth],
	{ request: Request }
> = [needsUser, auth];

export { chained, missing, ok, unmet };

// `onResponse` has no after-hook: returning a function is a type error.
export const noAfterHookOnResponse = definePlugin({
	name: 'no-after',
	// @ts-expect-error onResponse returns nothing; use setResponse
	onResponse: () => () => {},
});

// direct form: no requirement, `Added` inferred
const direct = definePlugin({
	name: 'direct',
	onContext: () => ({ flag: true }),
});
assertType<Equal<PluginContext<typeof direct>, { flag: boolean }>>();
assertType<Equal<PluginRequires<typeof direct>, Empty>>();
assertType<
	Equal<
		ContextOf<[typeof direct, typeof tenant]>,
		{ flag: boolean } & { tenant: string }
	>
>();
export const directOk: RequiresContext<[typeof direct], Empty> = [direct];
export const directThenNeeds: RequiresContext<
	[typeof direct, typeof needsFlag],
	Empty
> = [direct, needsFlag];

// direct form: reading a context field it does not require is a type error
definePlugin({
	name: 'direct-bad',
	onContext: ({ context }) => {
		// @ts-expect-error `request` is not required by a direct-form plugin
		void context.request;
		return {};
	},
});

// direct form: a type argument is refused (it would claim `Added` without `onContext`)
// @ts-expect-error use the curried form `definePlugin<In>()({ ... })`
definePlugin<{ request: Request }>({ name: 'direct-typed' });

// curried form keeps `In` and infers `Added`
const curried = definePlugin<{ request: Request }>()({
	name: 'curried',
	onContext: ({ context }) => ({ url: context.request.url }),
});
assertType<Equal<PluginContext<typeof curried>, { url: string }>>();
assertType<Equal<PluginRequires<typeof curried>, { request: Request }>>();
