import { createSchema } from '../create-schema';
import type { FixtureContext } from './context';
import { type Resolvers, Role } from './generated';
import { resolvers } from './resolvers';

const typeDefs = 'type Query { me: String }';

// the generated map is accepted as the codegen generic, with its own context
createSchema<FixtureContext, Resolvers>()({ typeDefs, resolvers: {} });
createSchema<FixtureContext, Resolvers<FixtureContext>>()({
	typeDefs,
	resolvers: [
		{
			Query: {
				me: (_p, _a, ctx) => ({
					id: ctx.user.id,
					name: '',
					role: Role.Admin,
					at: 0,
				}),
			},
		},
		{},
	],
});

// a resolver whose context is not the generated one is refused
createSchema<FixtureContext, Resolvers>()({
	typeDefs,
	// @ts-expect-error ctx must be FixtureContext
	resolvers: {
		Query: {
			me: (_p: unknown, _a: unknown, ctx: { other: string }) =>
				ctx.other ? null : null,
		},
	},
});

// a map generated for another context is refused
type Other = { other: string };
createSchema<FixtureContext, Resolvers<Other>>()({
	typeDefs,
	// @ts-expect-error built for Other, not FixtureContext
	resolvers: {},
});

// a complete generated map is accepted
createSchema<FixtureContext, Resolvers>()({
	typeDefs: 'type Query { me: String }',
	resolvers,
});

// a map for a supertype of the context is accepted
createSchema<FixtureContext, Resolvers<{ user: { id: string } }>>()({
	typeDefs,
	resolvers: {},
});
// a map needing more than the context provides is refused
createSchema<FixtureContext, Resolvers<FixtureContext & { db: string }>>()({
	typeDefs,
	// @ts-expect-error db is not in FixtureContext
	resolvers: {},
});
// an any context is accepted
createSchema<FixtureContext, Resolvers<any>>()({ typeDefs, resolvers: {} });
// no declared context: not checked
createSchema<unknown, Resolvers<{ other: 1 }>>()({ typeDefs, resolvers: {} });
// an optional key does not satisfy a required one
createSchema<{ user?: { id: string } }, Resolvers<{ user: { id: string } }>>()({
	typeDefs,
	// @ts-expect-error user may be missing
	resolvers: {},
});
