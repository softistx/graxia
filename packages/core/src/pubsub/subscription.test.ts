import { describe, expect, test } from 'bun:test';
import { parse, subscribe } from 'graphql';
import { createSchema } from '../schema/create-schema';
import { filterIterable } from './iterables';
import { createMemoryPubSub } from './memory';

type Post = { id: string; published: boolean };
type Topics = { [k: `post:${string}`]: Post };
type Ctx = { signal: AbortSignal };

describe('subscription end to end', () => {
	test('streams filtered events and stops when the signal aborts', async () => {
		const pubsub = createMemoryPubSub<Topics>();
		const schema = createSchema<Ctx>()({
			typeDefs: `
				type Query { _: Boolean }
				type Post { id: ID! }
				type Subscription { post(id: ID!): Post! }
			`,
			resolvers: {
				Subscription: {
					post: {
						subscribe: (_: unknown, args: { id: string }, ctx: Ctx) =>
							filterIterable(
								pubsub.subscribe(`post:${args.id}`, { signal: ctx.signal }),
								(p) => p.published,
							),
						resolve: (post: Post) => post,
					},
				},
			},
		});
		const controller = new AbortController();
		const result = await subscribe({
			schema,
			document: parse('subscription { post(id: "1") { id } }'),
			contextValue: { signal: controller.signal },
		});
		if (!(Symbol.asyncIterator in result)) throw new Error('not a stream');
		expect(pubsub.subscriberCount('post:1')).toBe(1);

		await pubsub.publish('post:1', { id: 'a', published: false });
		await pubsub.publish('post:1', { id: 'b', published: true });
		const first = await result.next();
		expect(first.value).toEqual({ data: { post: { id: 'b' } } });

		const pending = result.next();
		controller.abort();
		expect((await pending).done).toBe(true);
		expect(pubsub.subscriberCount('post:1')).toBe(0);
	});
});
