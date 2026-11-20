import { definePlugin } from '../plugins/define';
import type { OnParamsPayload } from '../plugins/types';
import { createSchema } from '../schema/create-schema';
import { createGraxia } from './create-graxia';
import type { InferContext } from './infer-context';
import type { ContextInit } from './options';

type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
		? true
		: false;
const assertType = <_T extends true>() => {};

type User = { id: string } | null;
const auth = async (_request: Request): Promise<User> => ({ id: '1' });
const context = async ({ request }: ContextInit) => ({
	user: await auth(request),
});
const tenant = definePlugin({
	name: 'tenant',
	onContext: () => ({ tenant: 'acme' }),
});
const plugins = [tenant] as const;

// the context is written once
type Ctx = InferContext<typeof context, typeof plugins>;
assertType<
	Equal<
		Ctx,
		{ user: User } & { tenant: string } & Record<never, never> & {
				readonly signal: AbortSignal;
			}
	>
>();
type Bare = InferContext;
assertType<Equal<Bare, { readonly signal: AbortSignal }>>();

const typeDefs = 'type Query { me: String tenant: String }';
const schema = createSchema<Ctx>()({
	typeDefs,
	resolvers: {
		Query: {
			me: (_, __, ctx) => {
				assertType<Equal<typeof ctx.user, User>>();
				return ctx.user?.id;
			},
			tenant: (_, __, ctx) => ctx.tenant,
		},
	},
});

// positive: factory + plugins, async factory, no factory, plain schema, unbranded host
createGraxia({ schema, context, plugins: [tenant] });
createGraxia({ schema, context, plugins });
createGraxia({
	schema,
	context: async ({ request }) => ({ user: await auth(request) }),
	plugins: [tenant],
});
createGraxia({
	schema: createSchema<{ signal: AbortSignal }>()({ typeDefs }),
});
createGraxia({ schema: createSchema()({ typeDefs }) });
createGraxia({
	schema: createSchema<{ tenant: string }>()({ typeDefs }),
	plugins: [tenant],
});
createGraxia({
	schema: createSchema<{ user: string }>()({ typeDefs }),
	context: () => ({ user: 'x' }),
});
const withHost = createSchema<{ user: string }>()({ typeDefs });
createGraxia<{ user: string }>({ schema: withHost });

// a plugin list not known as a tuple skips the check
declare const dynamic: ReturnType<typeof definePlugin>[];
createGraxia({ schema, context, plugins: dynamic });

// @ts-expect-error the plugin that adds `tenant` is missing
createGraxia({ schema, context });
// @ts-expect-error the factory that adds `user` is missing
createGraxia({ schema, plugins: [tenant] });
// @ts-expect-error `user` has the wrong type
createGraxia({ schema, context: () => ({ user: 42 }), plugins: [tenant] });
// @ts-expect-error a field of the schema context is not provided
createGraxia({ schema: createSchema<{ user: string }>()({ typeDefs }) });
// @ts-expect-error the schema context needs `user: string`, not `number`
createGraxia({ schema: withHost, context: () => ({ user: 1 }) });

// the schema needs a type the plugin cannot give: the factory must
createGraxia({
	schema: createSchema<{ tenant: number }>()({ typeDefs }),
	context: () => ({ tenant: 1 }),
	plugins: [tenant],
});

// connectionParams is typed on the init, no cast
const withParams = ({ connectionParams }: ContextInit) => ({
	token: String(connectionParams?.['token']),
});
assertType<Equal<InferContext<typeof withParams>['token'], string>>();
assertType<
	Equal<
		ContextInit['connectionParams'],
		Readonly<Record<string, unknown>> | undefined
	>
>();
assertType<
	Equal<
		OnParamsPayload['connectionParams'],
		Readonly<Record<string, unknown>> | undefined
	>
>();

// optional-only keys need no factory
createGraxia({
	schema: createSchema<{ opt?: string }>()({ typeDefs }),
});

// the host type is written once, in the factory's annotation
const hostContext = ({ serverContext }: ContextInit<{ db: string }>) => ({
	user: serverContext.db,
});
type HostCtx = InferContext<typeof hostContext>;
assertType<Equal<HostCtx['db'], string>>();
const hostSchema = createSchema<HostCtx>()({ typeDefs });
const hosted = createGraxia({ schema: hostSchema, context: hostContext });
export async function hostCalls() {
	await hosted.fetch(new Request('http://x'), { db: 'x' });
	// @ts-expect-error serverContext is required
	await hosted.fetch(new Request('http://x'));
}
createGraxia({
	schema: createSchema<{ db: string; user: number }>()({ typeDefs }),
	// @ts-expect-error the check still applies: `user` must be a number
	context: hostContext,
});
