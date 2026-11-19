import { describe, expect, test } from 'bun:test';
import { parse, subscribe } from 'graphql';
import { createSchema } from '../schema/create-schema';
import { filter } from './iterables';
import { createPubSub } from './memory';
import { pipe } from './pipe';

type Post = { id: string; published: boolean };
type Topics = { post: [id: string, payload: Post] };
type Ctx = Record<string, never>;

describe('subscription end to end', () => {
	test('streams filtered events and unsubscribes when the iterator is returned', async () => {
		const pubsub = createPubSub<Topics>();
		const schema = createSchema<Ctx>()({
			typeDefs: `
				type Query { _: Boolean }
				type Post { id: ID! }
				type Subscription { post(id: ID!): Post! }
			`,
			resolvers: {
				Subscription: {
					post: {
						subscribe: (_: unknown, args: { id: string }) =>
							pipe(
								pubsub.subscribe('post', args.id),
								filter((p) => p.published),
							),
						resolve: (post: Post) => post,
					},
				},
			},
		});
		const result = await subscribe({
			schema,
			document: parse('subscription { post(id: "1") { id } }'),
		});
		if (!(Symbol.asyncIterator in result)) throw new Error('not a stream');
		expect(pubsub.subscriberCount('post', '1')).toBe(1);

		await pubsub.publish('post', '1', { id: 'a', published: false });
		await pubsub.publish('post', '1', { id: 'b', published: true });
		const first = await result.next();
		expect(first.value).toEqual({ data: { post: { id: 'b' } } });

		// the engine returns the iterator when the operation's signal aborts (see sse.test.ts, ws tests)
		await result.return?.();
		expect(pubsub.subscriberCount('post', '1')).toBe(0);
	});
});
