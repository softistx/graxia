import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { SpanStatusCode } from '@opentelemetry/api';
import { pubsub, raw, start, until } from '../ws/ws.test-util';
import {
	closeAll,
	idOf,
	make,
	named,
	parentId,
	post,
	reset,
	tracer,
} from './telemetry.test-util';

beforeEach(reset);
afterEach(closeAll);

const sse = (body: unknown) => post(body, { accept: 'text/event-stream' });

describe('server-sent events', () => {
	test('a subscription span lives until the stream ends and counts its events', async () => {
		const response = await make().fetch(
			sse({ query: 'subscription { ticks }' }),
		);
		expect(named('graphql.request')).toHaveLength(0);
		const text = await response.text();
		expect(text).toContain('event: complete');
		await until(() => named('graphql.request').length === 1);
		const operation = named('subscription')[0];
		expect(operation?.attributes['graxia.events']).toBe(2);
		expect(
			operation?.events.filter((e) => e.name === 'graphql.event'),
		).toHaveLength(2);
		expect(parentId(operation as any)).toBe(
			idOf(named('graphql.request')[0] as any),
		);
		expect(operation?.status.code).toBe(SpanStatusCode.UNSET);
	});

	test('a cancelled stream still ends its spans', async () => {
		const response = await make().fetch(
			sse({ query: 'subscription { ticks }' }),
		);
		await response.body?.cancel();
		await until(() => named('graphql.request').length === 1);
		expect(named('subscription')).toHaveLength(1);
	});

	test('a query over SSE is one operation span', async () => {
		const response = await make().fetch(sse({ query: '{ hello }' }));
		await response.text();
		await until(() => named('graphql.request').length === 1);
		expect(named('query')).toHaveLength(1);
	});
});

describe('multipart incremental delivery', () => {
	test('a deferred query keeps the request span open until its last part', async () => {
		const response = await make().fetch(
			post(
				{ query: '{ hello ... @defer { user { slow } } }' },
				{ accept: 'multipart/mixed' },
			),
		);
		await response.text();
		await until(() => named('graphql.request').length === 1);
		expect(named('query')).toHaveLength(1);
		expect(
			named('query')[0]?.attributes['graxia.events'],
		).toBeGreaterThanOrEqual(2);
	});
});

describe('WebSocket', () => {
	test('the upgrade has a short request span and each subscribe an operation span', async () => {
		const { url } = start({ telemetry: { tracer } });
		const socket = raw(url);
		await socket.init();
		await socket.send({
			id: '1',
			type: 'subscribe',
			payload: { query: 'subscription { tick }' },
		});
		await until(() => pubsub.subscriberCount('tick') === 1);
		await pubsub.publish('tick', 1);
		await socket.next();
		await socket.send({ id: '1', type: 'complete' });
		await until(() => named('subscription').length === 1);
		const upgrade = named('graphql.request')[0];
		expect(upgrade?.attributes['http.request.method']).toBe('GET');
		expect(upgrade?.attributes['graxia.request.upgrade']).toBe(1);
		expect(upgrade?.attributes['http.response.status_code']).toBe(101);
		const operation = named('subscription')[0];
		expect(operation?.attributes['graxia.events']).toBe(1);
	});

	test('an operation parents to the traceparent of the upgrade request', async () => {
		const { server } = start({ telemetry: { tracer } });
		const traceId = '0af7651916cd43dd8448eb211c80319c';
		const socket = new WebSocket(`ws://localhost:${server.port}/graphql`, {
			protocols: ['graphql-transport-ws'],
			headers: { traceparent: `00-${traceId}-b7ad6b7169203331-01` },
		} as any);
		const messages: any[] = [];
		socket.addEventListener('message', (e) =>
			messages.push(JSON.parse(String(e.data))),
		);
		await new Promise((r) =>
			socket.addEventListener('open', r, { once: true }),
		);
		socket.send(JSON.stringify({ type: 'connection_init' }));
		await until(() => messages.length === 1);
		socket.send(
			JSON.stringify({
				id: '1',
				type: 'subscribe',
				payload: { query: '{ hello }' },
			}),
		);
		await until(() => named('query').length === 1);
		expect(named('query')[0]?.spanContext().traceId).toBe(traceId);
		socket.close();
	});
});
