import type { ContextOf } from '../plugins/define';
import type { MaybePromise } from '../plugins/types';
import type { ContextFactory, ContextInit } from './options';

/** What graxia itself always puts in the context of an operation. */
export interface CoreContext {
	/** Aborts when the client disconnects or the server shuts down past its timeout. */
	readonly signal: AbortSignal;
}

/** The result of a `context` factory, awaited. */
export type FactoryContext<Make> = Make extends (...args: any[]) => infer R
	? Awaited<R>
	: unknown;

/**
 * The context resolvers receive, written once: what the `context` factory
 * returns, what the plugins add (a tuple, as `ContextOf`) and what graxia
 * itself adds (`signal`). `HostCtx` is the `serverContext` type when the host
 * passes one to `fetch`.
 *
 * @example
 * const context = async ({ request }: ContextInit<object>) => ({ user: await auth(request) });
 * type Ctx = InferContext<typeof context, typeof plugins>;
 * const schema = createSchema<Ctx>()({ typeDefs, resolvers });
 */
export type InferContext<
	Make extends ContextFactory<any> | undefined = undefined,
	Plugins extends readonly unknown[] = [],
	HostCtx = unknown,
> = FactoryContext<Make> & ContextOf<Plugins> & HostCtx & CoreContext;

/** The context type a schema built with `createSchema<Ctx>()` expects (`{}` for a plain schema). */
export type SchemaContext<Schema> = Schema extends {
	readonly '~context'?: infer C;
}
	? unknown extends C
		? Record<never, never>
		: NonNullable<C>
	: Record<never, never>;

/**
 * What the `context` factory still has to return for `Schema`: the keys of its
 * context that the plugins, `serverContext` and graxia itself do not provide
 * with a fitting type. `{}` for a plain schema or a plugin list that is not a tuple.
 */
export type NeededContext<
	Schema,
	HostCtx,
	Plugins extends readonly unknown[],
> = '~none' extends keyof Plugins
	? Without<SchemaContext<Schema>, HostCtx & CoreContext>
	: number extends Plugins['length']
		? Record<never, never>
		: Without<
				SchemaContext<Schema>,
				ContextOf<Plugins> & HostCtx & CoreContext
			>;

type Without<Ctx, Others> = string extends keyof Ctx
	? Record<never, never>
	: {
			[K in keyof Ctx as K extends keyof Others
				? [Others[K]] extends [Ctx[K]]
					? never
					: K
				: K]: Ctx[K];
		};

/** `context` becomes required when the factory has something to provide. */
export type RequireContext<Needed, HostCtx> = keyof Needed extends never
	? unknown
	: {
			context: (init: ContextInit<HostCtx>) => MaybePromise<object>;
		};
