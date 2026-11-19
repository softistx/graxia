import type {
	GraphQLResolveInfo,
	GraphQLScalarType,
	GraphQLSchema,
} from 'graphql';
import type { TypeDefs } from './typedefs';

/**
 * A field resolver. `Args` and `Result` default to loose types; codegen output
 * (`typescript-resolvers`) is the way to get them exact.
 */
export type FieldResolver<
	Parent,
	Ctx,
	Args = Record<string, unknown>,
	Result = unknown,
> = (
	parent: Parent,
	args: Args,
	ctx: Ctx,
	info: GraphQLResolveInfo,
) => Result | Promise<Result>;

/** A subscription field: `subscribe` returns the event stream, `resolve` maps each event. */
export type SubscriptionFieldResolver<Ctx> = {
	resolve?: FieldResolver<any, Ctx>;
	subscribe?: FieldResolver<any, Ctx, any, AsyncIterable<unknown>>;
};

/**
 * `__resolveType` of an interface or a union: returns the concrete object type name.
 * Loosely typed (`any` parameters) so it can live beside field resolvers in one
 * map without losing the contextual typing of their parameters.
 */
export type TypeResolver = (
	value: any,
	ctx: any,
	info: any,
	abstractType: any,
) => string | undefined | null | Promise<string | undefined | null>;

/** `__isTypeOf` of an object type. Loosely typed, like {@link TypeResolver}. */
export type IsTypeOf = (
	value: any,
	ctx: any,
	info: any,
) => boolean | Promise<boolean>;

/** The resolvers of one object, interface or union type. */
export type TypeResolvers<Ctx> = {
	[field: string]:
		| FieldResolver<any, Ctx>
		| SubscriptionFieldResolver<Ctx>
		| undefined;
} & {
	__resolveType?: TypeResolver;
	__isTypeOf?: IsTypeOf;
};

/** Internal values of an enum, by value name. */
export type EnumValues = Record<string, string | number>;

/**
 * The built-in, loose resolver map: object and interface fields, custom
 * scalars (a `GraphQLScalarType`) and enum internal values, by type name.
 */
export type Resolvers<Ctx> = {
	[type: string]: TypeResolvers<Ctx> | GraphQLScalarType | EnumValues;
};

/** A schema carrying the context type its resolvers expect (type-level brand only). */
export type SchemaWithContext<Ctx> = GraphQLSchema & {
	readonly '~context'?: Ctx;
};

/** What `createSchema` accepts. */
export type SchemaOptions<R> = {
	/** SDL strings and/or documents; `extend type` across entries works. */
	typeDefs: TypeDefs;
	/** One resolver map or several, merged per type and field. */
	resolvers?: R | readonly R[];
	/**
	 * `false` leaves `@defer` and `@stream` out of the schema, so graphql's plain
	 * `execute` runs it (it refuses a schema that declares them). The schema then
	 * cannot serve incremental queries. Declared by default.
	 */
	incremental?: false;
};

type Fn = (...args: any[]) => any;
type IsAny<T> = 0 extends 1 & T ? true : false;
type ValueFns<V> =
	IsAny<V> extends true
		? never
		: V extends Fn
			? V
			: V extends { subscribe?: infer S; resolve?: infer R }
				? Extract<S | R, Fn>
				: never;
type MapFns<M> = M extends GraphQLScalarType
	? never
	: M extends object
		? ValueFns<M[Exclude<keyof M, `__${string}`>]>
		: never;
type CtxOfFn<F> = F extends (p: any, a: any, c: infer C, ...rest: any[]) => any
	? IsAny<C> extends true
		? never
		: C
	: never;
type Intersect<U> = (U extends unknown ? (u: U) => void : never) extends (
	u: infer I,
) => void
	? I
	: never;

/**
 * The context the field resolvers of a map expect: the intersection of their
 * third parameters (`unknown` when none declares one; `any` ones are ignored).
 */
export type ResolversContext<R> = [
	Intersect<CtxOfFn<{ [T in keyof R]-?: MapFns<NonNullable<R[T]>> }[keyof R]>>,
] extends [never]
	? unknown
	: Intersect<
			CtxOfFn<{ [T in keyof R]-?: MapFns<NonNullable<R[T]>> }[keyof R]>
		>;

/** Reported on `resolvers` when the map expects a context the schema's `Ctx` does not satisfy. */
export type ResolversContextMismatch<Expected, Ctx> = {
	readonly '~error': 'the resolvers expect another context than createSchema<Ctx>';
	readonly expected: Expected;
	readonly actual: Ctx;
};

/** Intersected into the options: refuses a map (or array of maps) built for a context `Ctx` does not satisfy. */
export type ContextCheck<Ctx, R> = unknown extends Ctx
	? unknown
	: [Ctx] extends [ResolversContext<R>]
		? unknown
		: { resolvers: ResolversContextMismatch<ResolversContext<R>, Ctx> };
