import { expect, test } from 'bun:test';
import { createSchema } from '../schema/create-schema';
import { createGraxia } from '../server/create-graxia';
import { definePlugin } from './define';

async function seen(subscriptions?: { sse?: boolean; ws?: boolean }) {
	let transports: unknown;
	const graxia = createGraxia({
		schema: createSchema()({
			typeDefs: 'type Query { a: String }',
			resolvers: {},
		}),
		...(subscriptions ? { subscriptions } : {}),
		plugins: [
			definePlugin()({
				name: 'probe',
				setup: (api) => {
					transports = api.transports;
				},
			}),
		],
	});
	await graxia.ready;
	await graxia.dispose();
	return transports;
}

test('setup sees both transports on by default', async () => {
	expect(await seen()).toEqual({ sse: true, ws: true });
});

test('setup sees the instance options', async () => {
	expect(await seen({ ws: false })).toEqual({ sse: true, ws: false });
	expect(await seen({ sse: false, ws: false })).toEqual({
		sse: false,
		ws: false,
	});
});
