import { GraphQLScalarType } from 'graphql';
import { createSchema } from './create-schema';
import type { FieldResolver, Resolvers, SchemaWithContext } from './types';

type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
		? true
		: false;
const assertType = <_T extends true>() => {};

type Ctx = { user: { id: string } };
const typeDefs = 'type Query { me: String }';

// the resolver context is Ctx
const schema = createSchema<Ctx>()({
	typeDefs,
	resolvers: {
		Query: {
			me: (_parent, _args, ctx) => {
				assertType<Equal<typeof ctx, Ctx>>();
				return ctx.user.id;
			},
		},
	},
});
assertType<Equal<typeof schema, SchemaWithContext<Ctx>>>();
assertType<Equal<NonNullable<(typeof schema)['~context']>, Ctx>>();

// an array of maps, a scalar and enum values are accepted
createSchema<Ctx>()({
	typeDefs,
	resolvers: [
		{ Query: { me: () => 'x' } },
		{ Date: new GraphQLScalarType({ name: 'Date' }), Color: { RED: 1 } },
	],
});

// a resolver expecting another context is an error
createSchema<Ctx>()({
	typeDefs,
	// @ts-expect-error ctx must be Ctx
	resolvers: {
		Query: {
			me: (_p: unknown, _a: unknown, ctx: { other: string }) => ctx.other,
		},
	},
});

// the codegen generic replaces the resolvers shape
type CodegenResolvers = {
	Query?: { me?: FieldResolver<unknown, Ctx, Record<string, never>, string> };
};
createSchema<Ctx, CodegenResolvers>()({
	typeDefs,
	resolvers: { Query: { me: () => 'x' } },
});
createSchema<Ctx, CodegenResolvers>()({
	typeDefs,
	// @ts-expect-error not in the codegen shape
	resolvers: { Mutation: {} },
});

// the default shape is the built-in Resolvers
assertType<
	Equal<
		Parameters<ReturnType<typeof createSchema<Ctx>>>[0]['resolvers'],
		Resolvers<Ctx> | readonly Resolvers<Ctx>[] | undefined
	>
>();

// the incremental opt-out accepts only false
createSchema()({ typeDefs: 'type Query { a: String }', incremental: false });
createSchema()({
	typeDefs: 'type Query { a: String }',
	// @ts-expect-error only `false` opts out
	incremental: true,
});
