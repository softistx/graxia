import { describe, expect, test } from 'bun:test';
import { createClient } from 'graphql-ws';
import { exposedError } from '../errors/exposed';
import { definePlugin } from '../plugins/define';
import { getContext } from '../server/context';
import { pubsub, raw, sleep, start, until } from './ws.test-util';

const client = (url: string, options: object = {}) =>
	createClient({ url, webSocketImpl: WebSocket, retryAttempts: 0, ...options });

async function collect(
	c: ReturnType<typeof client>,
	query: string,
	variables?: Record<string, unknown>,
) {
	const out: any[] = [];
	await new Promise<void>((resolve, reject) =>
		c.subscribe(
			{ query, ...(variables ? { variables } : {}) },
			{ next: (v) => out.push(v), error: reject, complete: resolve },
		),
	);
	return out;
}

describe('graphql-ws client', () => {
	test('a subscription receives events until the client unsubscribes', async () => {
		const { url } = start();
		const c = client(url);
		const seen: unknown[] = [];
		const dispose = c.subscribe(
			{ query: 'subscription { tick }' },
			{ next: (v) => seen.push(v.data), error: () => {}, complete: () => {} },
		);
		await until(() => pubsub.subscriberCount('tick') === 1);
		await pubsub.publish('tick', 1);
		await pubsub.publish('tick', 2);
		await until(() => seen.length === 2);
		expect(seen).toEqual([{ tick: 1 }, { tick: 2 }]);
		dispose();
		await until(() => pubsub.subscriberCount('tick') === 0);
		expect(pubsub.subscriberCount('tick')).toBe(0);
		await c.dispose();
	});

	test('a query and a mutation give one result then complete', async () => {
		const { url } = start();
		const c = client(url);
		expect(await collect(c, '{ hello }')).toEqual([
			{ data: { hello: 'world' } },
		]);
		expect(await collect(c, 'mutation { bump }')).toEqual([
			{ data: { bump: 1 } },
		]);
		await c.dispose();
	});

	test('a validation error is an error message, not a next', async () => {
		const { url } = start();
		const c = client(url);
		const error = await new Promise<any>((resolve) =>
			c.subscribe(
				{ query: '{ nope }' },
				{ next: () => {}, error: resolve, complete: () => {} },
			),
		);
		expect(error[0].message).toContain('Cannot query field "nope"');
		await c.dispose();
	});

	test('onResultChunk sees a validation error and a single result, with getContext()', async () => {
		const chunks: { errors?: unknown; who?: unknown }[] = [];
		const plugin = definePlugin({
			name: 'chunks',
			onResultChunk: ({ chunk }) => {
				let who: string | undefined;
				try {
					who = (getContext() as { who?: string }).who;
				} catch {
					// A failure before the operation's context exists has none.
				}
				chunks.push({ errors: (chunk as { errors?: unknown }).errors, who });
			},
		});
		const { url } = start({
			plugins: [plugin],
			context: () => ({ who: 'ctx' }),
		});
		const c = client(url);
		const results: unknown[] = [];
		await new Promise<void>((resolve) =>
			c.subscribe(
				{ query: '{ hello }' },
				{ next: (v) => results.push(v), error: () => {}, complete: resolve },
			),
		);
		expect(results).toEqual([{ data: { hello: 'world' } }]);
		expect(chunks).toHaveLength(1);
		expect(chunks[0]?.who).toBe('ctx');
		await new Promise<void>((resolve) =>
			c.subscribe(
				{ query: '{ nope }' },
				{ next: () => {}, error: () => resolve(), complete: () => {} },
			),
		);
		expect(chunks).toHaveLength(2);
		expect(JSON.stringify(chunks[1]?.errors)).toContain('Cannot query field');
		await c.dispose();
	});

	test('connectionParams reach onConnect and the context', async () => {
		const seen: unknown[] = [];
		const { url } = start({
			subscriptions: {
				ws: {
					onConnect: ({ connectionParams }) => {
						seen.push(connectionParams);
						return connectionParams?.['token'] === 'ok';
					},
				},
			},
		});
		const c = client(url, { connectionParams: { token: 'ok', user: 'ada' } });
		expect(await collect(c, '{ who }')).toEqual([{ data: { who: 'ada' } }]);
		expect(seen).toEqual([{ token: 'ok', user: 'ada' }]);
		await c.dispose();
	});

	test('onConnect returning an object is the ack payload; false closes 4403', async () => {
		const { url } = start({
			subscriptions: {
				ws: {
					onConnect: ({ connectionParams }) =>
						connectionParams ? { hi: 1 } : false,
				},
			},
		});
		const accepted = raw(url);
		expect(await accepted.init({ a: 1 })).toEqual({
			type: 'connection_ack',
			payload: { hi: 1 },
		});
		const refused = raw(url);
		await refused.send({ type: 'connection_init' });
		expect(await refused.closed).toMatchObject({
			code: 4403,
			reason: 'Forbidden',
		});
	});

	test('onConnect throwing an exposed error closes 4403, onDisconnect runs once', async () => {
		let disconnects = 0;
		const { url } = start({
			subscriptions: {
				ws: {
					onConnect: ({ connectionParams }) => {
						if (!connectionParams) throw exposedError('FORBIDDEN', 'no');
					},
					onDisconnect: () => void disconnects++,
				},
			},
		});
		const refused = raw(url);
		await refused.send({ type: 'connection_init' });
		expect((await refused.closed).code).toBe(4403);
		const ok = raw(url);
		await ok.init({ a: 1 });
		ok.socket.close();
		await ok.closed;
		await until(() => disconnects === 1);
		expect(disconnects).toBe(1);
	});

	test('an error result a hook emptied falls back to a generic error', async () => {
		const plugin = definePlugin({
			name: 'drop-errors',
			onResultChunk: ({ setChunk }) => setChunk({ data: null }),
		});
		const { url } = start({ plugins: [plugin] });
		const c = client(url);
		const error = await new Promise<any>((resolve) =>
			c.subscribe(
				{ query: '{ nope }' },
				{ next: () => {}, error: resolve, complete: () => {} },
			),
		);
		expect(error).toHaveLength(1);
		expect(error[0].message).toBe('The operation failed.');
		await c.dispose();
	});

	test('masks a thrown resolver error in an event and applies onResultChunk', async () => {
		const plugin = definePlugin({
			name: 'chunks',
			onResultChunk: ({ chunk, setChunk }) =>
				setChunk({ ...(chunk as object), extensions: { via: 'plugin' } }),
		});
		const { url } = start({ plugins: [plugin] });
		const c = client(url);
		const seen: any[] = [];
		const done = new Promise<void>((resolve) =>
			c.subscribe(
				{ query: 'subscription { boom }' },
				{ next: (v) => seen.push(v), error: () => {}, complete: resolve },
			),
		);
		await until(() => pubsub.subscriberCount('tick') === 1);
		await pubsub.publish('tick', 1);
		await until(() => seen.length === 1);
		expect(seen[0].errors[0].message).toBe('Unexpected error.');
		expect(JSON.stringify(seen[0])).not.toContain('secret detail');
		expect(seen[0].extensions).toEqual({ via: 'plugin' });
		await c.dispose();
		await done;
	});

	test('a GraphQLError thrown while iterating is exposed as is', async () => {
		const reported: unknown[] = [];
		const { url } = start({ onUnexpected: (e: unknown) => reported.push(e) });
		const c = client(url);
		const seen: any[] = [];
		await new Promise<void>((resolve) =>
			c.subscribe(
				{ query: 'subscription { gqlAfter }' },
				{
					next: (v) => seen.push(v),
					error: (e) => seen.push({ e }),
					complete: resolve,
				},
			),
		);
		const text = JSON.stringify(seen);
		expect(seen[0]).toEqual({ data: { gqlAfter: 1 } });
		expect(text).toContain('plain-gql');
		expect(text).toContain('"code":"X"');
		expect(text).not.toContain('Unexpected error.');
		expect(reported).toEqual([]);
		await c.dispose();
	});

	test('a plain Error thrown while iterating stays masked and reported', async () => {
		const reported: unknown[] = [];
		const { url } = start({ onUnexpected: (e: unknown) => reported.push(e) });
		const c = client(url);
		const seen: any[] = [];
		await new Promise<void>((resolve) =>
			c.subscribe(
				{ query: 'subscription { plainAfter }' },
				{
					next: (v) => seen.push(v),
					error: (e) => seen.push({ e }),
					complete: resolve,
				},
			),
		);
		const text = JSON.stringify(seen);
		expect(text).toContain('Unexpected error.');
		expect(text).not.toContain('db down');
		expect((reported[0] as Error).message).toBe('db down');
		await c.dispose();
	});

	test('getContext() works in a subscription resolver under asyncContext', async () => {
		const { url } = start({ context: () => ({ who: 'ctx' }) });
		const c = client(url);
		const seen: any[] = [];
		c.subscribe(
			{ query: 'subscription { who }' },
			{ next: (v) => seen.push(v.data), error: () => {}, complete: () => {} },
		);
		await until(() => pubsub.subscriberCount('tick') === 1);
		await pubsub.publish('tick', 1);
		await until(() => seen.length === 1);
		expect(seen).toEqual([{ who: 'ctx' }]);
		await c.dispose();
		await sleep(0);
	});

	test('onResultChunk sees what a subscription source threw', async () => {
		const chunks: { errors?: readonly { message: string }[] }[] = [];
		const plugin = definePlugin({
			name: 'watch',
			onResultChunk: ({ chunk }) => {
				chunks.push(chunk as (typeof chunks)[number]);
			},
		});
		const { url } = start({ plugins: [plugin] });
		const c = client(url);
		const out = await collect(c, 'subscription { plainAfter }');
		expect(out.at(-1).errors[0].message).toBe('Unexpected error.');
		expect(chunks.at(-1)?.errors?.[0]?.message).toBe('db down');
		await c.dispose();
	});
});
