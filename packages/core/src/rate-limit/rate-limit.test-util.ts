import type { GraxiaPlugin } from '../plugins/types';
import { createSchema } from '../schema/create-schema';
import { createGraxia } from '../server/create-graxia';
import type { FieldLimit } from './types';

export const schema = createSchema()({
	typeDefs: `
		type Query { signIn(email: String): Boolean hello: String profile: Profile }
		type Profile { signIn(email: String): Boolean name: String }
		type Subscription { tick: Int! }
	`,
	resolvers: {
		Query: { signIn: () => true, hello: () => 'world', profile: () => ({}) },
		Profile: { signIn: () => true, name: () => 'Ada' },
		Subscription: {
			tick: {
				subscribe: async function* () {
					yield 1;
				},
				resolve: (n: number) => n,
			},
		},
	},
});

/** A limit that lets `max` units through and records every `consume`. */
export function counter(max: number, retryAfter = 2500) {
	const calls: { key: string; cost: number }[] = [];
	let used = 0;
	const limit: FieldLimit = {
		consume(key, cost) {
			calls.push({ key, cost });
			if (used + cost > max) return { allowed: false, retryAfter };
			used += cost;
			return { allowed: true, retryAfter: 0 };
		},
	};
	return { limit, calls };
}

export function app(
	plugin: GraxiaPlugin<any>,
	extra: { context?: () => object; batching?: { limit: number } } = {},
) {
	return createGraxia({
		schema,
		plugins: [plugin],
		onUnexpected: false,
		...extra,
	} as Parameters<typeof createGraxia>[0]);
}

export function post(
	graxia: { fetch(request: Request): Promise<Response> },
	body: unknown,
	accept = 'application/json',
) {
	return graxia.fetch(
		new Request('http://x/graphql', {
			method: 'POST',
			headers: { 'content-type': 'application/json', accept },
			body: JSON.stringify(body),
		}),
	);
}
