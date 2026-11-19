import { afterAll, describe, expect, test } from 'bun:test';
import { requestIdKey } from '../http/request-id';
import { definePlugin } from '../plugins/define';
import { createGraxia } from './create-graxia';
import { schema } from './fixtures.test-util';

const plugin = definePlugin({
	name: 'headers',
	onRequest({ request, responseHeaders, respond, state }) {
		responseHeaders.set('x-plugin', 'kept');
		const url = new URL(request.url);
		if (url.searchParams.has('short'))
			respond(new Response('short', { status: 202 }));
		if (url.searchParams.has('throw')) throw new Error('hook failed');
		if (url.searchParams.has('id'))
			respond(new Response(state.get(requestIdKey) ?? 'none'));
	},
});

const graxia = createGraxia({
	schema,
	onUnexpected: false,
	plugins: [plugin],
	limits: { bodyBytes: 200 },
});
const batched = createGraxia({ schema, batching: { limit: 2 } });
const anyPath = createGraxia({ schema, path: false });
const servers = [
	graxia.serve({ port: 0 }),
	batched.serve({ port: 0 }),
	anyPath.serve({ port: 0 }),
];
const [main, batch, any] = servers.map((s) => `http://localhost:${s.port}`) as [
	string,
	string,
	string,
];
afterAll(() => {
	for (const s of servers) void s.stop(true);
});

const json = { 'content-type': 'application/json' };
const csrf = { headers: { 'x-graphql-csrf': '1' } };
const post = (url: string, body: unknown, headers: HeadersInit = json) =>
	fetch(url, {
		method: 'POST',
		headers,
		body: typeof body === 'string' ? body : JSON.stringify(body),
	});

describe('routing', () => {
	test('wrong path is 404, other methods are 405 with Allow', async () => {
		expect((await fetch(`${main}/other`)).status).toBe(404);
		const put = await fetch(`${main}/graphql`, { method: 'PUT' });
		expect(put.status).toBe(405);
		expect(put.headers.get('allow')).toBe('GET, POST');
		expect((await fetch(`${main}/graphql`, { method: 'DELETE' })).status).toBe(
			405,
		);
	});
	test('path: false serves any path', async () => {
		const res = await post(`${any}/anything/here`, { query: '{ hello }' });
		expect(await res.json()).toEqual({ data: { hello: 'world' } });
	});
});

describe('requests', () => {
	test('POST and GET run a query', async () => {
		const res = await post(`${main}/graphql`, { query: '{ hello }' });
		expect(await res.json()).toEqual({ data: { hello: 'world' } });
		const get = await fetch(
			`${main}/graphql?query=${encodeURIComponent('{ hello }')}`,
			csrf,
		);
		expect(await get.json()).toEqual({ data: { hello: 'world' } });
	});
	test('415 on a non-JSON content type, keeps the plugin header', async () => {
		const res = await post(`${main}/graphql`, '{ hello }', {
			'content-type': 'text/plain',
			'x-graphql-csrf': '1',
		});
		expect(res.status).toBe(415);
		expect(res.headers.get('x-plugin')).toBe('kept');
	});
	test('413 past the limit keeps the plugin header', async () => {
		const res = await post(`${main}/graphql`, {
			query: `{ hello }${' '.repeat(500)}`,
		});
		expect(res.status).toBe(413);
		expect(res.headers.get('x-plugin')).toBe('kept');
	});
	test('413 on a chunked body without Content-Length', async () => {
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(
					new TextEncoder().encode(`{"query":"{ hello }${' '.repeat(500)}"}`),
				);
				controller.close();
			},
		});
		const res = await fetch(`${main}/graphql`, {
			method: 'POST',
			headers: json,
			body: stream,
			duplex: 'half',
		} as RequestInit);
		expect(res.status).toBe(413);
	});
	test('a mutation over GET is 405 with Allow: POST', async () => {
		const res = await fetch(
			`${batch}/graphql?query=${encodeURIComponent('mutation { bump }')}`,
			csrf,
		);
		expect(res.status).toBe(405);
		expect(res.headers.get('allow')).toBe('POST');
		expect(
			(await post(`${batch}/graphql`, { query: 'mutation { bump }' })).status,
		).toBe(200);
	});
	test('406 when nothing acceptable is asked', async () => {
		const res = await post(
			`${main}/graphql`,
			{ query: '{ hello }' },
			{ ...json, accept: 'text/html' },
		);
		expect(res.status).toBe(406);
	});
	test('subscriptions are refused clearly', async () => {
		const res = await post(
			`${main}/graphql`,
			{ query: 'subscription { tick }' },
			{
				...json,
				accept: 'application/graphql-response+json',
			},
		);
		expect(res.status).toBe(400);
		expect(JSON.stringify(await res.json())).toContain('text/event-stream');
	});
	test('unknown and ambiguous operationName are 400 under graphql-response+json', async () => {
		const accept = { ...json, accept: 'application/graphql-response+json' };
		const unknown = await post(
			`${main}/graphql`,
			{ query: 'query A { hello }', operationName: 'B' },
			accept,
		);
		expect(unknown.status).toBe(400);
		const ambiguous = await post(
			`${main}/graphql`,
			{ query: 'query A { hello } query B { hello }' },
			accept,
		);
		expect(ambiguous.status).toBe(400);
	});
	test('field errors answer 200 with data', async () => {
		const res = await post(
			`${main}/graphql`,
			{ query: '{ hello boom }' },
			{
				...json,
				accept: 'application/graphql-response+json',
			},
		);
		expect(res.status).toBe(200);
		expect((await res.json()).errors).toHaveLength(1);
	});
});

describe('request id', () => {
	test('a client x-request-id is never echoed', async () => {
		const res = await post(
			`${main}/graphql`,
			{ query: '{ hello }' },
			{ ...json, 'x-request-id': 'client-chosen' },
		);
		const id = res.headers.get('x-request-id');
		expect(id).toMatch(/^[0-9a-f-]{36}$/);
		expect(id).not.toBe('client-chosen');
	});
	test('the id is in request state and differs per request', async () => {
		const a = await (await fetch(`${main}/graphql?id=1`, csrf)).text();
		const res = await fetch(`${main}/graphql?id=1`, csrf);
		expect(await res.text()).toBe(res.headers.get('x-request-id') as string);
		expect(a).not.toBe(res.headers.get('x-request-id'));
	});
});

describe('plugins', () => {
	test('onRequest respond short-circuits and keeps headers', async () => {
		const res = await fetch(`${main}/graphql?short=1`, csrf);
		expect(res.status).toBe(202);
		expect(await res.text()).toBe('short');
		expect(res.headers.get('x-plugin')).toBe('kept');
		expect(res.headers.get('x-request-id')).toBeTruthy();
	});
	test('a hook error is a generic 500', async () => {
		const res = await fetch(`${main}/graphql?throw=1`, csrf);
		expect(res.status).toBe(500);
		expect(await res.json()).toEqual({
			errors: [
				{
					message: 'Unexpected error.',
					extensions: {
						code: 'INTERNAL_SERVER_ERROR',
						fix: expect.any(String),
						correlationId: res.headers.get('x-request-id'),
					},
				},
			],
		});
	});
	test('a thrown context function is a generic 500', async () => {
		const bad = createGraxia({
			schema,
			onUnexpected: false,
			context: () => {
				throw new Error('nope');
			},
		});
		const res = await bad.fetch(
			new Request('http://x/graphql', {
				method: 'POST',
				headers: json,
				body: '{"query":"{ hello }"}',
			}),
		);
		expect(res.status).toBe(500);
		expect(await res.json()).toEqual({
			errors: [
				{
					message: 'Unexpected error.',
					extensions: {
						code: 'INTERNAL_SERVER_ERROR',
						fix: expect.any(String),
						correlationId: res.headers.get('x-request-id'),
					},
				},
			],
		});
	});
});

describe('batching', () => {
	test('off: an array is 400', async () => {
		const res = await post(`${main}/graphql`, [{ query: '{ hello }' }]);
		expect(res.status).toBe(400);
	});
	test('on: runs each entry and answers an array', async () => {
		const res = await post(`${batch}/graphql`, [
			{ query: '{ hello }' },
			{ query: '{ nope }' },
		]);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body[0]).toEqual({ data: { hello: 'world' } });
		expect(body[1].errors).toHaveLength(1);
	});
	test('over the limit is 400', async () => {
		const res = await post(`${batch}/graphql`, [
			{ query: '{ hello }' },
			{ query: '{ hello }' },
			{ query: '{ hello }' },
		]);
		expect(res.status).toBe(400);
	});
});

describe('host mounting', () => {
	test('fetch takes a server context merged into the context', async () => {
		const g = createGraxia<{ user: string }>({
			schema,
			plugins: [
				definePlugin({
					name: 'peek',
					onContext: ({ context }) => ({
						seen: (context as { user: string }).user,
					}),
					onExecute: ({ args }) => {
						expect((args.contextValue as { seen: string }).seen).toBe('ada');
					},
				}),
			],
			context: ({ serverContext }) => ({
				upper: serverContext.user.toUpperCase(),
			}),
		});
		const res = await g.fetch(
			new Request('http://x/graphql', {
				method: 'POST',
				headers: json,
				body: '{"query":"{ hello }"}',
			}),
			{ user: 'ada' },
		);
		expect(await res.json()).toEqual({ data: { hello: 'world' } });
	});
});
