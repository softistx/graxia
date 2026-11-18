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
