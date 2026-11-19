import { GraphQLScalarType } from 'graphql';
import { type Post, type Resolvers, Role } from './generated';
import type { UserRow } from './models';

export const rows: Record<string, UserRow> = {
	'1': { id: '1', name: 'Ada', role: Role.Admin, at: 0 },
};

const post = (title: string): Post & { author: UserRow } =>
	({ id: 'p1', title, author: rows['1'] }) as never;

/** A complete resolver map typed by the generated `Resolvers`. */
export const resolvers: Resolvers = {
	Date: new GraphQLScalarType<Date, number>({
		name: 'Date',
		serialize: (value) => (value as Date).getTime(),
		parseValue: (value) => new Date(value as number),
	}),
	Role: { ADMIN: Role.Admin, MEMBER: Role.Member },
	Node: { __resolveType: (value) => ('title' in value ? 'Post' : 'User') },
	SearchResult: {
		__resolveType: (value) => ('title' in value ? 'Post' : 'User'),
	},
	User: { joined: (user) => new Date(user.at) },
	Query: {
		me: (_parent, _args, ctx) => rows[ctx.user.id] ?? null,
		node: (_parent, { id }) => rows[id] ?? null,
		search: (_parent, { term }) => [rows['1'] as UserRow, post(term)],
		today: () => new Date(0),
	},
	Mutation: { addPost: (_parent, { input }) => post(input.title) },
	Subscription: {
		// without resolve: the stream yields the field's value
		clock: {
			subscribe: async function* () {
				yield { clock: 1 };
				yield { clock: 2 };
			},
		},
		// with resolve: each event is mapped
		postAdded: {
			subscribe: async function* (_parent, _args, ctx) {
				yield { title: ctx.user.id };
			},
			// codegen types the event as `any`: annotate it
			resolve: (event: { title: string }) => post(event.title),
		},
	},
};
