import { describe, expect, test } from 'bun:test';
import { GraphQLError } from 'graphql';
import { definePlugin } from '../plugins/define';
import { createSchema } from '../schema/create-schema';
import { createGraxia } from './create-graxia';

const refuse = (status: number, headers: Record<string, string> = {}) =>
	new GraphQLError('Refused.', {
		extensions: { code: 'REFUSED', http: { status, headers } },
	});

const schema = createSchema()({
	typeDefs: `
		type Query { hello: String }
		type Subscription { bad: Int! forbidden: Int! plain: Int! later: Int! ok: Int! }
	`,
	resolvers: {
		Query: { hello: () => 'world' },
		Subscription: {
			bad: {
				subscribe: () => {
					throw refuse(400, { 'x-reason': 'no-token' });
				},
				resolve: (n: number) => n,
			},
			forbidden: {
				subscribe: () => {
					throw refuse(403);
				},
				resolve: (n: number) => n,
			},
			plain: {
				subscribe: () => {
					throw new GraphQLError('No http.', { extensions: { code: 'PLAIN' } });
				},
				resolve: (n: number) => n,
			},
			later: {
				subscribe: async function* () {
					yield 1;
					throw refuse(403);
				},
				resolve: (n: number) => n,
			},
			ok: {
				subscribe: async function* () {
					yield 1;
				},
				resolve: (n: number) => n,
			},
		},
	},
});

const send = (
	app: { fetch(request: Request): Response | Promise<Response> },
	query: string,
	accept = 'text/event-stream',
) =>
	Promise.resolve(
		app.fetch(
			new Request('http://x/graphql', {
				method: 'POST',
				headers: { 'content-type': 'application/json', accept },
				body: JSON.stringify({ query }),
			}),
		),
	);

const app = createGraxia({ schema, onUnexpected: false });

describe('a subscription refused before its stream opens', () => {
	test('over SSE it answers the status and headers of its errors as plain JSON', async () => {
		const res = await send(app, 'subscription { bad }');
		expect(res.status).toBe(400);
		expect(res.headers.get('x-reason')).toBe('no-token');
		expect(res.headers.get('content-type')).toContain('application/json');
		const text = await res.text();
		expect(JSON.parse(text).errors[0].message).toBe('Refused.');
		expect(text).not.toContain('"http"');
		expect(text).not.toContain('event:');
	});

	test('over SSE a 403 answers 403', async () => {
		const res = await send(app, 'subscription { forbidden }');
		expect(res.status).toBe(403);
		expect(res.headers.get('content-type')).toContain('application/json');
	});

	test('the media type follows the Accept header, as for a query', async () => {
		const res = await send(
			app,
			'subscription { bad }',
			'text/event-stream, application/graphql-response+json',
		);
		expect(res.status).toBe(400);
		expect(res.headers.get('content-type')).toContain(
			'application/graphql-response+json',
		);
	});

	test('a plugin header set on the request still reaches it', async () => {
		const withPlugin = createGraxia({
			schema,
			onUnexpected: false,
			plugins: [
				definePlugin({
					name: 'tag',
					onResponse({ state }) {
						state.responseHeaders.set('x-tag', 'yes');
					},
				}),
			],
		});
		const res = await send(withPlugin, 'subscription { bad }');
		expect(res.status).toBe(400);
		expect(res.headers.get('x-tag')).toBe('yes');
		expect(res.headers.get('x-reason')).toBe('no-token');
	});

	test('over multipart/mixed a subscription is not served, so there is no stream to refuse', async () => {
		const res = await send(app, 'subscription { bad }', 'multipart/mixed');
		const body = (await res.json()) as any;
		expect(body.errors[0].extensions.code).toBe('SUBSCRIPTION_NOT_SUPPORTED');
	});

	test('errorHttp: false keeps the 200 stream with the errors in a next event', async () => {
		const off = createGraxia({ schema, onUnexpected: false, errorHttp: false });
		const res = await send(off, 'subscription { bad }');
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toContain('text/event-stream');
		expect(res.headers.get('x-reason')).toBeNull();
		expect(await res.text()).toContain('event: next');
	});

	test('without extensions.http it stays a 200 stream, as in Yoga', async () => {
		const res = await send(app, 'subscription { plain }');
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toContain('text/event-stream');
		const text = await res.text();
		expect(text).toContain('No http.');
		expect(text).toContain('event: complete');
	});

	test('a failure after the first event stays in the stream, http stripped', async () => {
		const res = await send(app, 'subscription { later }');
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toContain('text/event-stream');
		const text = await res.text();
		expect(text).toContain('{"data":{"later":1}}');
		expect(text).toContain('Refused.');
		expect(text).not.toContain('"http"');
	});

	test('a subscription that opens is a stream', async () => {
		const res = await send(app, 'subscription { ok }');
		expect(res.status).toBe(200);
		expect(await res.text()).toContain('{"data":{"ok":1}}');
	});
});
