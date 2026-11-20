import {
	createGraxia,
	createPubSub,
	createSchema,
	type GraxiaOptions,
	type GraxiaPlugin,
} from '@softistx/graxia';

/** How many times each resolver ran: specs reset it with `calls.reset()`. */
export const calls = {
	hello: 0,
	user: 0,
	reset() {
		this.hello = 0;
		this.user = 0;
	},
};

export const pubsub = createPubSub<{ tick: [payload: number] }>();

export const typeDefs = /* GraphQL */ `
	type Query {
		hello: String
		boom: String
		user(id: ID!): User
		deep: Deep
	}
	type Mutation {
		rename(id: ID!, name: String!): User
	}
	type Subscription {
		tick: Int!
	}
	type User {
		id: ID!
		name: String!
		bio: String
	}
	type Deep {
		value: Int
		next: Deep
	}
`;

const names = new Map([['1', 'Ada']]);

export const schema = createSchema()({
	typeDefs,
	resolvers: {
		Query: {
			hello: () => {
				calls.hello++;
				return 'world';
			},
			boom: () => {
				throw new Error('secret detail');
			},
			user: (_: unknown, { id }: Record<string, any>) => {
				calls.user++;
				return { id, name: names.get(id) ?? 'nobody' };
			},
			deep: () => ({
				value: 1,
				next: { value: 2, next: { value: 3, next: { value: 4 } } },
			}),
		},
		User: {
			bio: async () => {
				await new Promise((r) => setTimeout(r, 20));
				return 'late';
			},
		},
		Mutation: {
			rename: (_: unknown, { id, name }: Record<string, any>) => {
				names.set(id, name);
				return { id, name };
			},
		},
		Subscription: {
			tick: {
				subscribe: () => pubsub.subscribe('tick'),
				resolve: (n: number) => n,
			},
		},
	},
});

export interface Answer {
	status: number;
	type: string;
	json: any;
	text: string;
	headers: Headers;
}

export interface Booted {
	url: string;
	/** POSTs a GraphQL request and reads its single JSON answer. */
	gql(
		query: string,
		extra?: {
			variables?: object;
			headers?: Record<string, string>;
			operationName?: string;
		},
	): Promise<Answer>;
	/** POSTs with `accept` and gives the raw response (streams). */
	raw(
		query: string,
		accept: string,
		headers?: Record<string, string>,
	): Promise<Response>;
	graxia: ReturnType<typeof createGraxia>;
	stop(): Promise<void>;
}

/** Starts a graxia on a free port with `plugins`, over `schema` unless given. */
export function boot(
	plugins: readonly GraxiaPlugin<any, any>[],
	options: Partial<GraxiaOptions<any, any, any, any>> = {},
): Booted {
	const graxia = createGraxia({
		schema,
		plugins: [...plugins],
		...options,
	} as never) as ReturnType<typeof createGraxia>;
	const server = graxia.serve({ port: 0 });
	const url = `http://localhost:${server.port}/graphql`;
	const post = (
		query: string,
		accept: string,
		extra: {
			variables?: object;
			headers?: Record<string, string>;
			operationName?: string;
		} = {},
	) =>
		fetch(url, {
			method: 'POST',
			headers: { 'content-type': 'application/json', accept, ...extra.headers },
			body: JSON.stringify({
				query,
				...(extra.variables && { variables: extra.variables }),
				...(extra.operationName && { operationName: extra.operationName }),
			}),
		});
	return {
		url,
		graxia,
		async gql(query, extra) {
			const response = await post(
				query,
				'application/graphql-response+json',
				extra,
			);
			const text = await response.text();
			return {
				status: response.status,
				type: response.headers.get('content-type') ?? '',
				text,
				headers: response.headers,
				json: text ? JSON.parse(text) : undefined,
			};
		},
		raw: (query, accept, headers) =>
			post(query, accept, { headers: headers ?? {} }),
		stop: () => graxia.dispose({ timeout: 200 }),
	};
}

/** Reads a streamed response to its end. */
export async function readAll(response: Response): Promise<string> {
	return await response.text();
}
