import { describe, expect, test } from 'bun:test';
import { GraxiaConfigError } from '../errors/config-error';
import { createGraxia } from '../server/create-graxia';
import { pubsub, raw, schema, start, until } from './ws.test-util';

describe('close codes', () => {
	test('4408 when connection_init does not come in time', async () => {
		const { url } = start({
			subscriptions: { ws: { connectionInitWaitTimeout: 50 } },
		});
		expect(await raw(url).closed).toMatchObject({ code: 4408 });
	});

	test('4429 on a second connection_init', async () => {
		const { url } = start();
		const socket = raw(url);
		await socket.init();
		await socket.send({ type: 'connection_init' });
		expect(await socket.closed).toMatchObject({ code: 4429 });
	});

	test('4401 on subscribe before the ack', async () => {
		const { url } = start();
		const socket = raw(url);
		await socket.send({
			id: '1',
			type: 'subscribe',
			payload: { query: '{ hello }' },
		});
		expect(await socket.closed).toMatchObject({ code: 4401 });
	});

	test('4409 on a duplicate id while the operation is active', async () => {
		const { url } = start();
		const socket = raw(url);
		await socket.init();
		const subscribe = {
			id: 'a',
			type: 'subscribe',
			payload: { query: 'subscription { tick }' },
		};
		await socket.send(subscribe);
		await socket.send(subscribe);
		expect(await socket.closed).toMatchObject({
			code: 4409,
			reason: 'Subscriber for a already exists',
		});
	});

	test('an id can be reused once its operation completed', async () => {
		const { url } = start();
		const socket = raw(url);
		await socket.init();
		for (let i = 0; i < 2; i++) {
			await socket.send({
				id: 'a',
				type: 'subscribe',
				payload: { query: '{ hello }' },
			});
			expect((await socket.next()).type).toBe('next');
			expect(await socket.next()).toEqual({ id: 'a', type: 'complete' });
		}
	});

	test.each([
		['bad JSON', '{nope'],
		['no type', '{"id":"1"}'],
		['unknown type', '{"type":"hi"}'],
		[
			'subscribe without id',
			'{"type":"subscribe","payload":{"query":"{ hello }"}}',
		],
	])('4400 on %s', async (_name, message) => {
		const { url } = start();
		const socket = raw(url);
		await socket.init();
		await socket.send(message);
		expect(await socket.closed).toMatchObject({ code: 4400 });
	});

	test('4400 on a subscribe payload without a valid query', async () => {
		const { url } = start();
		const socket = raw(url);
		await socket.init();
		await socket.send({ id: '1', type: 'subscribe', payload: { query: 1 } });
		expect(await socket.closed).toMatchObject({ code: 4400 });
	});

	test('1009 above maxPayloadBytes', async () => {
		const { url } = start({ subscriptions: { ws: { maxPayloadBytes: 64 } } });
		const socket = raw(url);
		await socket.init();
		await socket.send(
			JSON.stringify({ type: 'ping', payload: { pad: 'x'.repeat(200) } }),
		);
		expect((await socket.closed).code).toBe(1009);
	});
});

describe('messages', () => {
	test('ping is answered with pong, payload echoed', async () => {
		const { url } = start();
		const socket = raw(url);
		await socket.init();
		await socket.send({ type: 'ping', payload: { n: 1 } });
		expect(await socket.next()).toEqual({ type: 'pong', payload: { n: 1 } });
		await socket.send({ type: 'ping' });
		expect(await socket.next()).toEqual({ type: 'pong' });
	});

	test('the server pings every keepAliveMs', async () => {
		const { url } = start({ subscriptions: { ws: { keepAliveMs: 30 } } });
		const socket = raw(url);
		await socket.init();
		expect(await socket.next()).toEqual({ type: 'ping' });
	});

	test('a client complete stops the operation without a server complete', async () => {
		const { url } = start();
		const socket = raw(url);
		await socket.init();
		await socket.send({
			id: '1',
			type: 'subscribe',
			payload: { query: 'subscription { tick }' },
		});
		await until(() => pubsub.subscriberCount('tick') === 1);
		await socket.send({ id: '1', type: 'complete' });
		await until(() => pubsub.subscriberCount('tick') === 0);
		expect(pubsub.subscriberCount('tick')).toBe(0);
		await socket.send({ type: 'ping' });
		// the next message is the pong: no complete came back
		expect(await socket.next()).toEqual({ type: 'pong' });
	});
});

describe('handshake and options', () => {
	test('a socket without the subprotocol is refused with a 400', async () => {
		const { url } = start();
		const socket = raw(url, 'other');
		expect((await socket.closed).code).toBe(1006);
		const response = await fetch(url.replace('ws:', 'http:'), {
			headers: {
				upgrade: 'websocket',
				connection: 'Upgrade',
				'sec-websocket-version': '13',
				'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
			},
		});
		expect(response.status).toBe(400);
	});

	test('ws: false leaves the upgrade to HTTP handling', async () => {
		const { url } = start({ subscriptions: { ws: false } });
		expect((await raw(url).closed).code).toBe(1006);
	});

	test('a plugin may refuse the upgrade in onRequest', async () => {
		const { url } = start({
			plugins: [
				{
					name: 'gate',
					onRequest: ({ respond }: any) =>
						respond(new Response('no', { status: 403 })),
				},
			],
		});
		expect((await raw(url).closed).code).toBe(1006);
	});

	test.each([
		[
			{ connectionInitWaitTimeout: 0 },
			'subscriptions.ws.connectionInitWaitTimeout must be a positive integer (milliseconds)',
		],
		[
			{ keepAliveMs: -1 },
			'subscriptions.ws.keepAliveMs must be a non-negative integer (milliseconds, 0 turns pings off)',
		],
		[
			{ maxPayloadBytes: 1.5 },
			'subscriptions.ws.maxPayloadBytes must be a positive integer (bytes)',
		],
	])('rejects %j', (ws, message) => {
		expect(() => createGraxia({ schema, subscriptions: { ws } })).toThrow(
			new GraxiaConfigError(message),
		);
	});
});
