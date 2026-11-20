import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { type SpanRecord, span, withTelemetry } from '@softistx/telemetry';
import { definePlugin } from '../plugins/define';
import { createSchema } from '../schema/create-schema';
import { createGraxia } from '../server/create-graxia';
import { pubsub, raw, until, schema as wsSchema } from '../ws/ws.test-util';
import {
	closeAll,
	finished,
	idOf,
	instance,
	make,
	named,
	parentId,
	post,
	reset,
	traceOf,
} from './telemetry.test-util';

beforeEach(reset);
afterEach(closeAll);

const names = () =>
	finished()
		.map((s) => s.name)
		.sort();
const query = '{ hello }';
const off = { instance, operationSpans: false };
/** Runs `work` the way a host does: inside a span of its own. */
const hosted = <T>(work: () => Promise<T>) =>
	withTelemetry(instance, () => span('host', { kind: 'server' }, work));
const one = (name: string): SpanRecord => {
	const spans = named(name);
	expect(spans).toHaveLength(1);
	return spans[0] as SpanRecord;
};
const sameTrace = () => {
	const traces = new Set(finished().map(traceOf));
	expect([...traces]).toHaveLength(1);
};

describe('operationSpans over HTTP', () => {
	test('true (the default): request, operation, parse and validate', async () => {
		await make().fetch(post({ query }));
		expect(names()).toEqual([
			'graphql.parse',
			'graphql.request',
			'graphql.validate',
			'query',
		]);
	});

	test('false under a host span: only the step spans, children of the host span', async () => {
		const graxia = make({ telemetry: off });
		await hosted(() => graxia.fetch(post({ query })));
		await instance.flush();
		expect(names()).toEqual(['graphql.parse', 'graphql.validate', 'host']);
		const host = one('host');
		for (const name of ['graphql.parse', 'graphql.validate'])
			expect(parentId(one(name))).toBe(idOf(host));
		sameTrace();
	});

	test('false under a host span, with resolver spans: they hang under the host span too', async () => {
		const graxia = make({ telemetry: { ...off, resolverSpans: true } });
		await hosted(() => graxia.fetch(post({ query })));
		await instance.flush();
		expect(names()).toEqual([
			'graphql.parse',
			'graphql.resolve hello',
			'graphql.validate',
			'host',
		]);
		expect(parentId(one('graphql.resolve hello'))).toBe(idOf(one('host')));
	});

	test('false under a host span: the host span carries the operation facts and the document', async () => {
		const graxia = make({ telemetry: { ...off, document: true } });
		await hosted(() =>
			graxia.fetch(
				post({
					query: 'query Hi { hello }',
					extensions: { persistedQuery: { sha256Hash: 'abc' } },
				}),
			),
		);
		await instance.flush();
		expect(one('host').attributes).toMatchObject({
			'graphql.operation.type': 'query',
			'graphql.operation.name': 'Hi',
			'graphql.document': 'query Hi { hello }',
			'graxia.document.id': 'abc',
		});
		expect(one('host').name).toBe('host');
		expect(
			one('graphql.validate').attributes['graphql.document'],
		).toBeUndefined();
	});

	test('false under a host span: the cause of a masked error is a failed graphql.error span', async () => {
		const graxia = make({ telemetry: off });
		const response = await hosted(() =>
			graxia.fetch(post({ query: '{ boom }' })),
		);
		expect(JSON.stringify(await response.json())).not.toContain(
			'secret detail',
		);
		await instance.flush();
		const cause = one('graphql.error');
		expect(cause.status).toBe('error');
		expect(cause.error?.message).toBe('secret detail');
		expect(parentId(cause)).toBe(idOf(one('host')));
		expect(named('graphql.request')).toHaveLength(0);
	});

	test('false with resolver spans: the cause is on the resolver span only', async () => {
		const graxia = make({ telemetry: { ...off, resolverSpans: true } });
		await hosted(() => graxia.fetch(post({ query: '{ boom }' })));
		await instance.flush();
		expect(one('graphql.resolve boom').status).toBe('error');
		expect(named('graphql.error')).toHaveLength(0);
	});

	test('false: a timeout is not a graphql.error', async () => {
		const graxia = make({ telemetry: off });
		await hosted(() => graxia.fetch(post({ query: '{ timeout }' })));
		await instance.flush();
		expect(named('graphql.error')).toHaveLength(0);
	});

	test('false: a hook that throws is a failed graphql.error span', async () => {
		const graxia = make({
			telemetry: off,
			plugins: [
				definePlugin({
					name: 'boom',
					onExecute: () => {
						throw new Error('hook failed');
					},
				}),
			],
		});
		await hosted(() => graxia.fetch(post({ query })));
		await instance.flush();
		expect(one('graphql.error').error?.message).toBe('hook failed');
	});

	test('false: a failing payload of an SSE subscription is a graphql.error span', async () => {
		const failing = createSchema()({
			typeDefs: 'type Query { a: Int } type Subscription { ticks: Int! }',
			resolvers: {
				Subscription: {
					ticks: {
						subscribe: async function* () {
							yield 1;
						},
						resolve: () => {
							throw new Error('payload boom');
						},
					},
				},
			},
		});
		const graxia = make({ schema: failing, telemetry: off });
		const response = await hosted(() =>
			graxia.fetch(
				post(
					{ query: 'subscription { ticks }' },
					{ accept: 'text/event-stream' },
				),
			),
		);
		await response.text();
		await until(() => named('graphql.error').length === 1);
		await instance.flush();
		expect(one('graphql.error').error?.message).toBe('payload boom');
		expect(named('graphql.request')).toHaveLength(0);
		sameTrace();
	});

	test('false with no host span: nothing to duplicate, graxia makes its spans and reads traceparent', async () => {
		const traceId = '0af7651916cd43dd8448eb211c80319c';
		await make({ telemetry: off }).fetch(
			post({ query }, { traceparent: `00-${traceId}-b7ad6b7169203331-01` }),
		);
		expect(names()).toEqual([
			'graphql.parse',
			'graphql.request',
			'graphql.validate',
			'query',
		]);
		expect(traceOf(one('graphql.request'))).toBe(traceId);
		sameTrace();
		for (const name of ['query', 'graphql.parse', 'graphql.validate'])
			expect(parentId(one(name))).toBeDefined();
	});

	test('a non-boolean value is a config error', () => {
		expect(() => make({ telemetry: { operationSpans: 'no' } })).toThrow(
			'telemetry.operationSpans must be a boolean',
		);
	});
});

describe('operationSpans over a WebSocket', () => {
	/** A server that spans the upgrade request itself, as a host does. */
	const serve = (telemetry: object, host: boolean, schema: any = wsSchema) => {
		const graxia = createGraxia({
			schema,
			onUnexpected: false,
			telemetry,
		});
		const upgrade = (request: Request, server: Bun.Server<any>) =>
			graxia.upgrade(request, server);
		const server = Bun.serve({
			port: 0,
			fetch: (request, server) =>
				graxia.isUpgrade(request)
					? host
						? hosted(async () => upgrade(request, server))
						: upgrade(request, server)
					: graxia.fetch(request),
			websocket: graxia.websocket,
		});
		return { graxia, url: `ws://localhost:${server.port}/graphql`, server };
	};

	const subscribe = async (url: string) => {
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
		await until(() => named('graphql.validate').length === 1);
		await new Promise((r) => setTimeout(r, 50));
		await instance.flush();
		socket.socket.close();
	};

	test('true: the upgrade request span and the subscription span', async () => {
		const { url, server } = serve({ instance }, false);
		await subscribe(url);
		await server.stop(true);
		expect(names()).toEqual([
			'graphql.parse',
			'graphql.request',
			'graphql.validate',
			'subscription',
		]);
	});

	test('false under a host span: step spans only, in the trace of the host upgrade span', async () => {
		const { url, server } = serve(off, true);
		await subscribe(url);
		await server.stop(true);
		expect(names()).toEqual(['graphql.parse', 'graphql.validate', 'host']);
		sameTrace();
		for (const name of ['graphql.parse', 'graphql.validate'])
			expect(parentId(one(name))).toBe(idOf(one('host')));
	});

	test('false under a host span: a masked failing payload is a graphql.error in the host trace', async () => {
		const failing = createSchema()({
			typeDefs: 'type Query { a: Int } type Subscription { tick: Int! }',
			resolvers: {
				Subscription: {
					tick: {
						subscribe: async function* () {
							yield 1;
						},
						resolve: () => {
							throw new Error('payload boom');
						},
					},
				},
			},
		});
		const { url, server } = serve(off, true, failing);
		const socket = raw(url);
		await socket.init();
		await socket.send({
			id: '1',
			type: 'subscribe',
			payload: { query: 'subscription { tick }' },
		});
		await until(() => named('graphql.error').length === 1);
		await instance.flush();
		socket.socket.close();
		await server.stop(true);
		const cause = one('graphql.error');
		expect(cause.error?.message).toBe('payload boom');
		expect(traceOf(cause)).toBe(traceOf(one('host')));
		expect(parentId(cause)).toBe(idOf(one('host')));
	});

	test('false with no host span: graxia makes its spans, in one trace', async () => {
		const { url, server } = serve(off, false);
		await subscribe(url);
		await server.stop(true);
		expect(names()).toEqual([
			'graphql.parse',
			'graphql.request',
			'graphql.validate',
			'subscription',
		]);
		sameTrace();
		expect(parentId(one('subscription'))).toBe(idOf(one('graphql.request')));
	});
});
