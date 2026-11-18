import { afterEach } from 'bun:test';
import { meros } from 'meros/browser';
import { createSchema } from '../schema/create-schema';
import { getContext } from './context';
import { createGraxia, type Graxia } from './create-graxia';

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const schema = createSchema<{ signal: AbortSignal }>()({
	typeDefs: `
		type Query { hello: String user: User friends: [String!]! never: Never }
		type User { name: String slow: String bad: String who: String }
		type Never { value: String }
	`,
	resolvers: {
		Query: {
			hello: () => 'world',
			user: () => ({}),
			friends: async function* () {
				yield 'ann';
				await sleep(5);
				yield 'bob';
				await sleep(5);
				yield 'cat';
			},
			never: () => ({}),
		},
		User: {
			name: () => 'Ada',
			slow: async () => {
				await sleep(20);
				return 'late';
			},
			bad: () => {
				throw new Error('secret detail');
			},
			who: () => String((getContext() as { user?: string }).user),
		},
		Never: {
			value: (_: unknown, __: unknown, ctx) =>
				new Promise((resolve, reject) => {
					ctx.signal.addEventListener('abort', () => reject(ctx.signal.reason));
					void resolve;
				}),
		},
	},
});

let graxia: Graxia | undefined;
export const make = (
	options: Partial<Parameters<typeof createGraxia>[0]> = {},
) => (graxia = createGraxia({ schema, onUnexpected: false, ...options }));
afterEach(async () => {
	await graxia?.dispose({ timeout: 200 });
	graxia = undefined;
});

export const MULTIPART = 'multipart/mixed;deferSpec=20220824, application/json';
export const post = (query: string, accept: string, headers = {}) =>
	new Request('http://x/graphql', {
		method: 'POST',
		headers: { 'content-type': 'application/json', accept, ...headers },
		body: JSON.stringify({ query }),
	});

export async function parts(response: Response): Promise<any[]> {
	const out: any[] = [];
	const stream = await meros(response);
	if (!(Symbol.asyncIterator in stream)) throw new Error('not multipart');
	for await (const part of stream)
		out.push((part as { json: boolean; body: unknown }).body);
	return out;
}

export const DEFER = '{ hello user { name ... @defer { slow } } }';
