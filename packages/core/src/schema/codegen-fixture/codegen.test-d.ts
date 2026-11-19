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
