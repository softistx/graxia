import { filterIterable, mapIterable } from './iterables';
import { createMemoryPubSub } from './memory';
import type { PubSub } from './types';

type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
		? true
		: false;
const assertType = <_T extends true>() => {};

type Post = { id: string };
type Topics = { [k: `post:${string}`]: Post; tick: number };
declare const pubsub: PubSub<Topics>;

// template-literal keys and plain keys type their payloads
pubsub.publish('post:42', { id: '1' });
pubsub.publish('tick', 1);
// @ts-expect-error wrong payload for a template key
pubsub.publish('post:42', 1);
// @ts-expect-error wrong payload for a plain key
pubsub.publish('tick', 'x');
// @ts-expect-error unknown topic
pubsub.publish('nope', 1);

const posts = pubsub.subscribe('post:42');
assertType<Equal<typeof posts, AsyncIterableIterator<Post>>>();
const ticks = pubsub.subscribe('tick');
assertType<Equal<typeof ticks, AsyncIterableIterator<number>>>();

// the memory implementation is a PubSub with a subscriber count
const memory = createMemoryPubSub<Topics>();
const asPubSub: PubSub<Topics> = memory;
void asPubSub;
assertType<Equal<ReturnType<typeof memory.subscriberCount>, number>>();

// a type guard narrows the filtered element type
declare const mixed: AsyncIterable<string | number>;
const strings = filterIterable(
	mixed,
	(v): v is string => typeof v === 'string',
);
assertType<Equal<typeof strings, AsyncIterableIterator<string>>>();
const plain = filterIterable(mixed, (v) => v !== 0);
assertType<Equal<typeof plain, AsyncIterableIterator<string | number>>>();

// mapIterable follows the mapper's return type
const lengths = mapIterable(posts, (p) => p.id.length);
assertType<Equal<typeof lengths, AsyncIterableIterator<number>>>();
const asyncMapped = mapIterable(ticks, async (n) => String(n));
assertType<Equal<typeof asyncMapped, AsyncIterableIterator<string>>>();
