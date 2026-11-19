import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
	closeAll,
	finished,
	idOf,
	make,
	named,
	parentId,
	post,
	reset,
} from './telemetry.test-util';

beforeEach(reset);
afterEach(closeAll);

const one = (name: string) => {
	const spans = named(name);
	expect(spans).toHaveLength(1);
	return spans[0] as (typeof spans)[number];
};

describe('span tree', () => {
	test('a POST query is a request span over an operation span with parse and validate under it', async () => {
		const response = await make().fetch(post({ query: '{ hello }' }));
		expect(response.status).toBe(200);
		const request = one('graphql.request');
		const operation = one('query');
		expect(request.kind).toBe('server');
		expect(parentId(operation)).toBe(idOf(request));
		expect(parentId(one('graphql.parse'))).toBe(idOf(operation));
		expect(parentId(one('graphql.validate'))).toBe(idOf(operation));
		expect(request.attributes['http.request.method']).toBe('POST');
		expect(request.attributes['http.response.status_code']).toBe(200);
		expect(request.attributes['graxia.request.id']).toBe(
			response.headers.get('x-request-id'),
		);
		expect(request.status).toBe('ok');
		expect(operation.attributes['graphql.operation.type']).toBe('query');
		expect(operation.attributes['graphql.operation.name']).toBeUndefined();
		expect(operation.attributes['graphql.document']).toBeUndefined();
	});

	test('a named operation is "<type> <name>"', async () => {
		await make().fetch(
			post({
				query: 'query GetUser { user { name } } mutation M { bump }',
				operationName: 'GetUser',
			}),
		);
		const operation = one('query GetUser');
		expect(operation.attributes['graphql.operation.name']).toBe('GetUser');
		await make().fetch(post({ query: 'mutation Bump { bump }' }));
		expect(one('mutation Bump').attributes['graphql.operation.type']).toBe(
			'mutation',
		);
	});

	test('the second request is served by the parse and validation caches', async () => {
		const graxia = make();
		await graxia.fetch(post({ query: '{ hello }' }));
		await graxia.fetch(post({ query: '{ hello }' }));
		const parses = named('graphql.parse');
		const validates = named('graphql.validate');
		expect(parses.map((s) => s.attributes['graxia.cache.hit'])).toEqual([
			false,
			true,
		]);
		expect(validates.map((s) => s.attributes['graxia.cache.hit'])).toEqual([
			false,
			true,
		]);
	});

	test('a batch is one request span and one operation span per entry', async () => {
		await make({ batching: { limit: 5 } }).fetch(
			post([{ query: '{ hello }' }, { query: 'mutation { bump }' }]),
		);
		const request = one('graphql.request');
		expect(named('query')).toHaveLength(1);
		expect(named('mutation')).toHaveLength(1);
		for (const span of [...named('query'), ...named('mutation')])
			expect(parentId(span)).toBe(idOf(request));
	});

	test('a GET query is traced', async () => {
		await make().fetch(
			new Request(`http://x/graphql?query=${encodeURIComponent('{ hello }')}`, {
				headers: { 'x-graphql-csrf': '1' },
			}),
		);
		expect(one('graphql.request').attributes['http.request.method']).toBe(
			'GET',
		);
		expect(named('query')).toHaveLength(1);
	});

	test('graxia.execute is traced like a request', async () => {
		await make().execute({ document: '{ hello }' });
		expect(named('graphql.request')).toHaveLength(1);
		expect(parentId(one('query'))).toBe(idOf(one('graphql.request')));
	});

	test('a path that is not the GraphQL path is not traced', async () => {
		await make().fetch(new Request('http://x/other'));
		expect(finished()).toHaveLength(0);
	});
});

describe('errors', () => {
	test('a validation error counts errors and is not an ERROR status', async () => {
		await make().fetch(post({ query: '{ nope }' }));
		expect(one('graphql.validate').attributes['graphql.error.count']).toBe(1);
		expect(one('graphql.validate').status).toBe('ok');
		expect(one('graphql.request').status).toBe('ok');
	});

	test('an unexpected resolver error records the original and marks the operation ERROR; the client sees it masked', async () => {
		const response = await make().fetch(post({ query: '{ boom }' }));
		expect(JSON.stringify(await response.json())).not.toContain(
			'secret detail',
		);
		const operation = one('query');
		expect(operation.status).toBe('error');
		expect(operation.attributes['graphql.error.count']).toBe(1);
		expect(operation.error?.message).toBe('secret detail');
		// A request that answered 200 is not an ERROR request.
		expect(one('graphql.request').status).toBe('ok');
	});

	test('a plugin that throws is an ERROR operation and a 500 ERROR request', async () => {
		const response = await make({
			plugins: [
				{
					name: 'bad',
					onExecute: () => {
						throw new Error('hook failed');
					},
				},
			],
		}).fetch(post({ query: '{ hello }' }));
		expect(response.status).toBe(500);
		expect(one('query').status).toBe('error');
		expect(one('graphql.request').status).toBe('error');
		expect(one('graphql.request').attributes['http.response.status_code']).toBe(
			500,
		);
	});

	test('a CSRF refusal is traced with its code and no ERROR status', async () => {
		const response = await make().fetch(
			new Request(`http://x/graphql?query=${encodeURIComponent('{ hello }')}`),
		);
		expect(response.status).toBe(403);
		const request = one('graphql.request');
		expect(request.attributes['http.response.status_code']).toBe(403);
		expect(request.attributes['graxia.refusal.code']).toBe(
			'CSRF_HEADER_REQUIRED',
		);
		expect(request.status).toBe('ok');
		expect(named('query')).toHaveLength(0);
	});

	test('a persisted document id is an attribute', async () => {
		const graxia = make({
			trustedDocuments: { manifest: { abc: '{ hello }' } },
		});
		await graxia.fetch(post({ documentId: 'abc' }));
		expect(one('query').attributes['graxia.document.id']).toBe('abc');
	});
});
