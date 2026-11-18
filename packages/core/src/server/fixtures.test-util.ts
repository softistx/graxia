import { createSchema } from '../schema/create-schema';

/** Schema shared by the server specs. */
export const schema = createSchema()({
	typeDefs: `
		type Query { hello: String boom: String }
		type Mutation { bump: Int }
		type Subscription { tick: Int }
	`,
	resolvers: {
		Query: {
			hello: () => 'world',
			boom: () => {
				throw new Error('secret detail');
			},
		},
		Mutation: { bump: () => 1 },
	},
});
