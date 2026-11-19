import { filter, map, pipe } from './iterables';
import { createPubSub } from './memory';
import type { PubSub, PubSubIterator } from './types';

type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
		? true
		: false;
const assertType = <_T extends true>() => {};

type Post = { id: string };
type Topics = {
	post: [id: string, payload: Post];
	tick: [payload: number];
	ping: [];
};
declare const pubsub: PubSub<Topics>;

// ids and payloads are typed as in Yoga's createPubSub
pubsub.publish('post', '42', { id: '1' });
pubsub.publish('tick', 1);
pubsub.publish('ping');
// @ts-expect-error wrong payload for a topic with an id
pubsub.publish('post', '42', 1);
// @ts-expect-error the id is missing
pubsub.publish('post', { id: '1' });
// @ts-expect-error wrong payload for a plain topic
pubsub.publish('tick', 'x');
// @ts-expect-error unknown topic
pubsub.publish('nope', 1);

const posts = pubsub.subscribe('post', '42');
assertType<Equal<typeof posts, PubSubIterator<Post>>>();
const ticks = pubsub.subscribe('tick');
assertType<Equal<typeof ticks, PubSubIterator<number>>>();
const pings = pubsub.subscribe('ping');
assertType<Equal<typeof pings, PubSubIterator<null>>>();
// @ts-expect-error the id is a string
pubsub.subscribe('post', 42);
// @ts-expect-error a topic with an id needs it
pubsub.subscribe('post');
// @ts-expect-error a topic without an id takes none
pubsub.subscribe('tick', '1');
// @ts-expect-error unknown topic
pubsub.subscribe('nope');

// the memory implementation is a PubSub with a subscriber count
const memory = createPubSub<Topics>();
const asPubSub: PubSub<Topics> = memory;
void asPubSub;
assertType<Equal<ReturnType<typeof memory.subscriberCount>, number>>();

// a type guard narrows the filtered element type
declare const mixed: AsyncIterable<string | number>;
const strings = pipe(
	mixed,
	filter((v): v is string => typeof v === 'string'),
);
assertType<Equal<typeof strings, PubSubIterator<string>>>();
const plain = pipe(
	mixed,
	filter((v) => v !== 0),
);
assertType<Equal<typeof plain, PubSubIterator<string | number>>>();

// map follows the mapper's return type, and pipe chains operators
const lengths = pipe(
	posts,
	map((p) => p.id.length),
);
assertType<Equal<typeof lengths, PubSubIterator<number>>>();
const chained = pipe(
	ticks,
	filter((n) => n > 0),
	map(async (n) => String(n)),
);
assertType<Equal<typeof chained, PubSubIterator<string>>>();

// return() and throw() are always there, as Yoga's Repeater
void posts.return();
void posts.throw(new Error('x'));

// a long chain still compiles (the 10th operator falls back to the variadic overload)
const id = <T>(v: T) => v;
const long = pipe(ticks, id, id, id, id, id, id, id, id, id, id);
void long;
// @ts-expect-error the id is a string
memory.subscriberCount('post', 42);
