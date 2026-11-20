import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { span, withTelemetry } from '@softistx/telemetry';
import { pubsub, raw, start, until } from '../ws/ws.test-util';
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
} from './telemetry.test-util';

beforeEach(reset);
afterEach(closeAll);

const names = () =>
	finished()
		.map((s) => s.name)
		.sort();
const query = '{ hello }';
/** Runs `work` the way a host does: inside a span of its own. */
const hosted = (work: () => Promise<unknown>) =>
	withTelemetry(instance, () => span('host', {}, work));

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

	test('false: only the step spans, under the host span', async () => {
		const graxia = make({ telemetry: { instance, operationSpans: false } });
		await hosted(() => graxia.fetch(post({ query })));
		await instance.flush();
		expect(names()).toEqual(['graphql.parse', 'graphql.validate', 'host']);
		const host = named(
			'host',
		)[0] as typeof finished extends () => readonly (infer S)[] ? S : never;
		for (const name of ['graphql.parse', 'graphql.validate'])
			expect(parentId(named(name)[0] as typeof host)).toBe(idOf(host));
	});

	test('false with resolver spans: they hang under the host span too', async () => {
		const graxia = make({
			telemetry: { instance, operationSpans: false, resolverSpans: true },
		});
		await hosted(() => graxia.fetch(post({ query })));
		await instance.flush();
		expect(names()).toEqual([
			'graphql.parse',
			'graphql.resolve hello',
			'graphql.validate',
			'host',
		]);
		expect(parentId(named('graphql.resolve hello')[0] as never)).toBe(
			idOf(named('host')[0] as never),
		);
	});

	test('false: the document is on the validate span with document: true', async () => {
		await make({
			telemetry: { instance, operationSpans: false, document: true },
		}).fetch(post({ query }));
		expect(named('graphql.validate')[0]?.attributes['graphql.document']).toBe(
			query,
		);
		expect(named('graphql.parse')[0]?.attributes['graphql.document']).toBe(
			undefined,
		);
	});

	test('false: the cause of a masked error is a failed graphql.error span', async () => {
		const response = await make({
			telemetry: { instance, operationSpans: false },
		}).fetch(post({ query: '{ boom }' }));
		const body = (await response.json()) as any;
		expect(JSON.stringify(body)).not.toContain('secret detail');
		const cause = named('graphql.error')[0];
		expect(cause?.status).toBe('error');
		expect(cause?.error?.message).toBe('secret detail');
		expect(named('graphql.request')).toHaveLength(0);
		expect(named('boom')).toHaveLength(0);
	});

	test('a non-boolean value is a config error', () => {
		expect(() => make({ telemetry: { operationSpans: 'no' } })).toThrow(
			'telemetry.operationSpans must be a boolean',
		);
	});
});

describe('operationSpans over a WebSocket', () => {
	const subscribe = async (telemetry: object) => {
		const { url } = start({ telemetry });
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
	};

	test('true: the upgrade request span and the subscription span', async () => {
		await subscribe({ instance });
		expect(names()).toEqual([
			'graphql.parse',
			'graphql.request',
			'graphql.validate',
			'subscription',
		]);
	});

	test('false: only the step spans', async () => {
		await subscribe({ instance, operationSpans: false });
		expect(names()).toEqual(['graphql.parse', 'graphql.validate']);
	});
});
