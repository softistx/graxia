import { describe, expect, test } from 'bun:test';
import { createGraxia } from '../server/create-graxia';
import { pubsub, raw, schema, sleep, start, until } from './ws.test-util';

describe('shutdown', () => {
	test('dispose closes every socket with 1001, promptly, ending the sources', async () => {
		const { graxia, url } = start();
		const a = raw(url);
		const b = raw(url);
		await a.init();
		await b.init();
		await a.send({
			id: '1',
			type: 'subscribe',
			payload: { query: 'subscription { tick }' },
		});
		await b.send({
			id: '1',
			type: 'subscribe',
			payload: { query: 'subscription { tick }' },
		});
		await until(() => pubsub.subscriberCount('tick') === 2);
		const started = Date.now();
		await graxia.dispose({ timeout: 5000 });
		expect(Date.now() - started).toBeLessThan(2000);
		expect((await a.closed).code).toBe(1001);
		expect((await b.closed).code).toBe(1001);
		expect(pubsub.subscriberCount('tick')).toBe(0);
	});

	test('an idle socket does not hold dispose', async () => {
		const { graxia, url } = start();
		const socket = raw(url);
		await socket.init();
		const started = Date.now();
		await graxia.dispose({ timeout: 5000 });
		expect(Date.now() - started).toBeLessThan(2000);
		expect((await socket.closed).code).toBe(1001);
	});

	test('closing the socket ends its operations', async () => {
		const { url } = start();
		const socket = raw(url);
		await socket.init();
		await socket.send({
			id: '1',
			type: 'subscribe',
			payload: { query: 'subscription { tick }' },
		});
		await until(() => pubsub.subscriberCount('tick') === 1);
		socket.socket.close();
		await until(() => pubsub.subscriberCount('tick') === 0);
		expect(pubsub.subscriberCount('tick')).toBe(0);
	});

	test('an upgrade during shutdown is a 503', async () => {
		const { graxia, url } = start();
		void graxia.dispose({ timeout: 100 });
		await sleep(0);
		const socket = raw(url);
		expect((await socket.closed).code).toBe(1006);
	});
});

describe('own Bun.serve', () => {
	test('graxia.upgrade and graxia.websocket', async () => {
		const graxia = createGraxia({ schema, onUnexpected: false });
		const server = Bun.serve({
			port: 0,
			fetch: (request, server) =>
				graxia.isUpgrade(request)
					? graxia.upgrade(request, server)
					: graxia.fetch(request),
			websocket: graxia.websocket,
		});
		try {
			const socket = raw(`ws://localhost:${server.port}/graphql`);
			expect((await socket.init()).type).toBe('connection_ack');
			await socket.send({
				id: '1',
				type: 'subscribe',
				payload: { query: '{ hello }' },
			});
			expect(await socket.next()).toEqual({
				id: '1',
				type: 'next',
				payload: { data: { hello: 'world' } },
			});
			const http = await fetch(
				`http://localhost:${server.port}/graphql?query={hello}`,
				{ headers: { 'x-graphql-csrf': '1' } },
			);
			expect(await http.json()).toEqual({ data: { hello: 'world' } });
		} finally {
			await server.stop(true);
			await graxia.dispose({ timeout: 100 });
		}
	});

	test('hooks run once on a plain GET and on a refused upgrade', async () => {
		let seen = 0;
		const graxia = createGraxia({
			schema,
			onUnexpected: false,
			plugins: [{ name: 'count', onRequest: () => void seen++ }],
		});
		const server = Bun.serve({
			port: 0,
			fetch: (request, server) =>
				graxia.isUpgrade(request)
					? graxia.upgrade(request, server)
					: graxia.fetch(request),
			websocket: graxia.websocket,
		});
		const base = `http://localhost:${server.port}/graphql`;
		try {
			expect(
				(
					await fetch(`${base}?query={hello}`, {
						headers: { 'x-graphql-csrf': '1' },
					})
				).status,
			).toBe(200);
			expect(seen).toBe(1);
			const refused = await fetch(base, {
				headers: {
					upgrade: 'websocket',
					connection: 'Upgrade',
					'sec-websocket-version': '13',
					'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
					'sec-websocket-protocol': 'other',
				},
			});
			expect(refused.status).toBe(400);
			expect(refused.headers.get('x-request-id')).toBeTruthy();
			expect(seen).toBe(2);
		} finally {
			await server.stop(true);
			await graxia.dispose({ timeout: 100 });
		}
	});
});
