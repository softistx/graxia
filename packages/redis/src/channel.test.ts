import { expect, test } from 'bun:test';
import { createPubSub } from '@softistx/graxia';
import { channelOf } from './channel';

test('the redis channel is the topic:id core uses', async () => {
	expect(channelOf('post', '42')).toBe('post:42');
	expect(channelOf('tick', undefined)).toBe('tick');
	// core addresses (post, 42) as the topic `post:42`: the two must not drift
	const pubsub = createPubSub<{
		post: [id: string, payload: number];
		'post:42': [payload: number];
	}>();
	const events = pubsub.subscribe('post', '42');
	await pubsub.publish('post:42', 9);
	expect((await events.next()).value).toBe(9);
});
