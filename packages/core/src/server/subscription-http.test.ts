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
		type Subscription { bad: Int! forbidden: Int! plain: Int! later: Int! ok: Int! spec: Int! sneaky: Int! }
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
			spec: {
				subscribe: () => {
					throw new GraphQLError('Spec.', {
						extensions: { http: { status: 400, spec: true } },
					});
				},
				resolve: (n: number) => n,
			},
			sneaky: {
				subscribe: () => {
					const error = new Error('secret detail');
					Object.assign(error, { extensions: { http: { status: 418 } } });
					throw error;
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

const bodyOf = async (res: Response) => {
	const text = await res.text();
	expect(res.headers.get('content-type')).toContain('text/event-stream');
	expect(text).not.toContain('"http"');
	expect(text).toContain('event: next');
	expect(text).toContain('event: complete');
	return text;
};

describe('a subscription refused before its stream opens', () => {
	test('over SSE it keeps the stream with the status and headers of its errors', async () => {
		const res = await send(app, 'subscription { bad }');
		expect(res.status).toBe(400);
		expect(res.headers.get('x-reason')).toBe('no-token');
		expect(await bodyOf(res)).toContain('Refused.');
	});

	test('over SSE a 403 answers 403', async () => {
		const res = await send(app, 'subscription { forbidden }');
		expect(res.status).toBe(403);
		expect(await bodyOf(res)).toContain('Refused.');
	});

	test('spec: true does not drop the status over SSE, as in Yoga', async () => {
		const res = await send(app, 'subscription { spec }');
		expect(res.status).toBe(400);
		await bodyOf(res);
	});

	test('the status does not depend on Accept', async () => {
		const res = await send(
			app,
			'subscription { bad }',
			'text/event-stream, application/graphql-response+json',
		);
		expect(res.status).toBe(400);
		await bodyOf(res);
	});

	test('an onSubscribe setResult answers the same way', async () => {
		const set = createGraxia({
			schema,
			onUnexpected: false,
			plugins: [
				definePlugin({
					name: 'set',
					onSubscribe({ setResult }) {
						setResult({ errors: [refuse(403, { 'x-set': '1' })] });
					},
				}),
			],
		});
		const res = await send(set, 'subscription { ok }');
		expect(res.status).toBe(403);
		expect(res.headers.get('x-set')).toBe('1');
		await bodyOf(res);
	});

	test('an unexpected error carrying http is masked: a 200 stream with Unexpected error.', async () => {
		const res = await send(app, 'subscription { sneaky }');
		expect(res.status).toBe(200);
		const text = await bodyOf(res);
		expect(text).toContain('Unexpected error.');
		expect(text).not.toContain('418');
		expect(text).not.toContain('secret detail');
	});

	test('a maskError that adds http sets the status', async () => {
		const masked = createGraxia({
			schema,
			onUnexpected: false,
			maskError: (error) =>
				new GraphQLError('Masked.', {
					originalError: error as Error,
					extensions: { http: { status: 503, headers: { 'x-m': '1' } } },
				}),
		});
		const res = await send(masked, 'subscription { sneaky }');
		expect(res.status).toBe(503);
		expect(res.headers.get('x-m')).toBe('1');
		await bodyOf(res);
	});

	test('onResultChunk runs once for the pre-stream payload and its change sets the status', async () => {
		let runs = 0;
		const hooked = createGraxia({
			schema,
			onUnexpected: false,
			plugins: [
				definePlugin({
					name: 'chunk',
					onResultChunk({ chunk, setChunk }) {
						runs++;
						const c = chunk as { errors?: unknown[] };
						if (c.errors) setChunk({ data: null });
					},
				}),
			],
		});
		const res = await send(hooked, 'subscription { bad }');
		expect(runs).toBe(1);
		expect(res.status).toBe(200);
		expect(res.headers.get('x-reason')).toBeNull();
		await bodyOf(res);
	});

	test('over multipart/mixed a subscription is not served, so there is no stream to refuse', async () => {
		const res = await send(app, 'subscription { bad }', 'multipart/mixed');
		expect(res.status).toBe(200);
		const body = (await res.json()) as any;
		expect(body.errors[0].extensions.code).toBe('SUBSCRIPTION_NOT_SUPPORTED');
	});

	test('errorHttp: false keeps the 200 stream with the errors in a next event', async () => {
		const off = createGraxia({ schema, onUnexpected: false, errorHttp: false });
		const res = await send(off, 'subscription { bad }');
		expect(res.status).toBe(200);
		expect(res.headers.get('x-reason')).toBeNull();
		expect(res.headers.get('content-type')).toContain('text/event-stream');
		expect(await res.text()).toContain('event: next');
	});

	test('without extensions.http it stays a 200 stream', async () => {
		const res = await send(app, 'subscription { plain }');
		expect(res.status).toBe(200);
		expect(await bodyOf(res)).toContain('No http.');
	});

	test('a failure after the first event stays in the stream, http stripped', async () => {
		const res = await send(app, 'subscription { later }');
		expect(res.status).toBe(200);
		const text = await bodyOf(res);
		expect(text).toContain('{"data":{"later":1}}');
		expect(text).toContain('Refused.');
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

	test('a subscription that opens is a stream', async () => {
		const res = await send(app, 'subscription { ok }');
		expect(res.status).toBe(200);
		expect(await res.text()).toContain('{"data":{"ok":1}}');
	});
});
