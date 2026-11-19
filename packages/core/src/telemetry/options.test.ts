import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { span, withTelemetry } from '@softistx/telemetry';
import { createGraxia } from '../server/create-graxia';
import { schema as plain } from '../server/fixtures.test-util';
import { apiLoader } from './api';
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
	schema,
	seen,
	traceOf,
	until,
} from './telemetry.test-util';

beforeEach(reset);
afterEach(closeAll);

const one = (name: string) => {
	const spans = named(name);
	expect(spans).toHaveLength(1);
	return spans[0] as (typeof spans)[number];
};

describe('options', () => {
	test('document: true puts the source on the operation span', async () => {
		await make({ telemetry: { instance, document: true } }).fetch(
			post({ query: '{ hello }' }),
		);
		expect(one('query').attributes['graphql.document']).toBe('{ hello }');
	});

	test('telemetry: false makes no span', async () => {
		await make({ telemetry: false }).fetch(post({ query: '{ hello }' }));
		expect(finished()).toHaveLength(0);
	});

	test('without the package (loader finds nothing) there is no span and no wrapping', async () => {
		const resolve = plain.getQueryType()?.getFields()['hello']?.resolve;
		const original = apiLoader.load;
		apiLoader.load = () => undefined;
		try {
			const graxia = createGraxia({
				schema: plain,
				telemetry: { resolverSpans: { trivial: true } },
			});
			expect((await graxia.execute({ document: '{ hello }' })).data).toEqual({
				hello: 'world',
			});
			await graxia.dispose();
		} finally {
			apiLoader.load = original;
		}
		expect(finished()).toHaveLength(0);
		expect(plain.getQueryType()?.getFields()['hello']?.resolve).toBe(resolve);
	});

	test('the invalid values are config errors', () => {
		const bad = (telemetry: unknown, message: string) =>
			expect(() => createGraxia({ schema, telemetry } as any)).toThrow(message);
		bad(true, 'telemetry must be false or an object');
		bad(
			{ instance: 'x' },
			'telemetry.instance must be a @softistx/telemetry Telemetry',
		);
		bad({ tracer: {} }, 'telemetry.tracer was replaced by telemetry.instance');
		bad({ document: 1 }, 'telemetry.document must be a boolean');
		bad({ propagate: 'yes' }, 'telemetry.propagate must be a boolean');
		bad(
			{ resolverSpans: 'all' },
			'telemetry.resolverSpans must be a boolean or { trivial?: boolean }',
		);
		bad(
			{ resolverSpans: { trivial: 1 } },
			'telemetry.resolverSpans must be a boolean or { trivial?: boolean }',
		);
	});
});

describe('propagation', () => {
	const traceId = '0af7651916cd43dd8448eb211c80319c';
	const parent = `00-${traceId}-b7ad6b7169203331-01`;

	test('a traceparent header parents the request span', async () => {
		await make().fetch(post({ query: '{ hello }' }, { traceparent: parent }));
		const request = one('graphql.request');
		expect(traceOf(request)).toBe(traceId);
		expect(parentId(request)).toBe('b7ad6b7169203331');
		expect(request.kind).toBe('server');
	});

	test('propagate: false ignores it', async () => {
		await make({ telemetry: { instance, propagate: false } }).fetch(
			post({ query: '{ hello }' }, { traceparent: parent }),
		);
		expect(traceOf(one('graphql.request'))).not.toBe(traceId);
	});

	test('with a host span active the request span is its INTERNAL child', async () => {
		const graxia = make();
		let hostId = '';
		await withTelemetry(instance, () =>
			span('host', async (scope) => {
				hostId = scope.spanId;
				await graxia.fetch(
					post({ query: '{ hello }' }, { traceparent: parent }),
				);
			}),
		);
		await instance.flush();
		const request = one('graphql.request');
		expect(parentId(request)).toBe(hostId);
		expect(request.kind).toBe('internal');
	});
});

describe('resolver spans', () => {
	const query = '{ hello user { name slow } }';

	test('off by default', async () => {
		await make().fetch(post({ query }));
		expect(named('graphql.resolve hello')).toHaveLength(0);
	});

	test('on: a span per resolver you wrote, under the operation, with field attributes', async () => {
		await make({ telemetry: { instance, resolverSpans: true } }).fetch(
			post({ query }),
		);
		const operation = one('query');
		const hello = one('graphql.resolve hello');
		expect(parentId(hello)).toBe(idOf(operation));
		expect(hello.attributes).toMatchObject({
			'graphql.field.name': 'hello',
			'graphql.field.path': 'hello',
			'graphql.field.type': 'String',
			'graphql.parent.type': 'Query',
		});
		expect(one('graphql.resolve slow').attributes['graphql.field.path']).toBe(
			'user.slow',
		);
		expect(named('graphql.resolve name')).toHaveLength(0);
	});

	test('trivial: true adds the fields with no resolver', async () => {
		await make({
			telemetry: { instance, resolverSpans: { trivial: true } },
		}).fetch(post({ query: '{ user { name } }' }));
		expect(named('graphql.resolve name')).toHaveLength(1);
	});

	test('a throwing resolver span is ERROR with the exception', async () => {
		await make({ telemetry: { instance, resolverSpans: true } }).fetch(
			post({ query: '{ boom }' }),
		);
		const boom = one('graphql.resolve boom');
		expect(boom.status).toBe('error');
		expect(boom.error?.message).toBe('secret detail');
	});

	test('a timeout in a resolver ends the resolver and operation spans cancelled', async () => {
		await make({ telemetry: { instance, resolverSpans: true } }).fetch(
			post({ query: '{ timeout }' }),
		);
		expect(one('graphql.resolve timeout').status).toBe('cancelled');
		expect(one('query').status).toBe('cancelled');
	});

	test('the active span in a resolver is the resolver span, or the operation span without resolver spans', async () => {
		seen.span = undefined;
		await make().fetch(post({ query: '{ hello }' }));
		expect((seen.span as any).spanId).toBe(idOf(one('query')));
		reset();
		await make({ telemetry: { instance, resolverSpans: true } }).fetch(
			post({ query: '{ hello }' }),
		);
		expect((seen.span as any).spanId).toBe(idOf(one('graphql.resolve hello')));
	});

	test('a resolver of an instance with tracing off runs unwrapped', async () => {
		await make({ telemetry: { instance, resolverSpans: true } }).dispose();
		reset();
		await make({ telemetry: false }).fetch(post({ query: '{ hello }' }));
		expect(finished()).toHaveLength(0);
	});
});

test('the request span of a 200 ends before fetch resolves', async () => {
	await make().fetch(post({ query: '{ hello }' }));
	await until(() => named('graphql.request').length > 0, 50);
	expect(named('graphql.request')).toHaveLength(1);
});
