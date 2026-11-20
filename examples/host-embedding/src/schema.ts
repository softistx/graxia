import { createSchema } from '@softistx/graxia';
import type { Ctx } from './context';

const sleep = (ms: number, signal: AbortSignal) =>
	new Promise<void>((resolve) => {
		const timer = setTimeout(resolve, ms);
		signal.addEventListener(
			'abort',
			() => {
				clearTimeout(timer);
				resolve();
			},
			{ once: true },
		);
	});

export const schema = createSchema<Ctx>()({
	typeDefs: `
		type Query {
			hello: String!
			me: String
			"Answers after the given milliseconds, or at once when the client leaves."
			slow(ms: Int!): Int!
		}
		type Mutation { login(name: String!): Boolean! }
		type Subscription { ticks(every: Int!): Int! }
	`,
	resolvers: {
		Query: {
			hello: () => 'world',
			me: (_: unknown, __: unknown, ctx) => ctx.user ?? null,
			slow: async (_: unknown, { ms }: { ms: number }, ctx) => {
				await sleep(ms, ctx.signal);
				return ms;
			},
		},
		Mutation: {
			login: (_: unknown, { name }: { name: string }, ctx) => {
				ctx.set.cookies.set('session', name, {
					httpOnly: true,
					sameSite: 'lax',
				});
				ctx.set.headers.set('cache-control', 'no-store');
				return true;
			},
		},
		Subscription: {
			ticks: {
				subscribe: async function* (
					_: unknown,
					{ every }: { every: number },
					ctx,
				) {
					for (let n = 1; !ctx.signal.aborted; n++) {
						await sleep(every, ctx.signal);
						if (ctx.signal.aborted) return;
						yield n;
					}
				},
				resolve: (n: number) => n,
			},
		},
	},
});
