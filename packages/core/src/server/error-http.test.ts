import { describe, expect, test } from 'bun:test';
import { GraphQLError } from 'graphql';
import { createClient } from 'graphql-ws';
import { exposedError } from '../errors/exposed';
import type { ErrorHttp } from '../http/error-http';
import { definePlugin } from '../plugins/define';
import { createSchema } from '../schema/create-schema';
import { start } from '../ws/ws.test-util';
import { createGraxia } from './create-graxia';
import { httpRefusalKey } from './http-refusal';

const fail = (message: string, http: unknown, extra = {}) =>
	new GraphQLError(message, { extensions: { code: 'X', http, ...extra } });

const schema = createSchema()({
	typeDefs: `type Query {
		hello: String
		conflict: String
		many: String
		spec: String
		bad: String
		sneaky: String
		plain: String
		exposed: String
		later: String
		encoded: String
	}`,
	resolvers: {
		Query: {
			hello: () => 'world',
			conflict: () => {
				throw fail('Taken.', { status: 409, headers: { 'x-conflict': 'a' } });
			},
			many: () => {
				throw fail('Gone.', { status: 410, headers: { 'x-many': '1' } });
			},
			spec: () => {
				throw fail('Spec.', {
					status: 400,
					spec: true,
					headers: { 'x-spec': '1' },
				});
			},
			bad: () => {
				throw fail('Bad.', {
					status: 99,
					headers: { 'bad header': 'x', 'x-ok': 'y' },
				});
			},
			sneaky: () => {
				const error = new Error('secret detail');
				Object.assign(error, { extensions: { http: { status: 418 } } });
				throw error;
			},
			exposed: () => {
				throw exposedError('CONFLICT', 'Taken.', {
					fix: 'Sign in.',
					extensions: { http: { status: 409 } satisfies ErrorHttp },
				});
			},
			later: () => {
				throw fail('Later.', { status: 202, headers: { 'x-conflict': 'b' } });
			},
			encoded: () => {
				throw fail('Encoded.', {
					status: 418,
					headers: {
						'content-encoding': 'gzip',
						'content-length': '1',
						'x-keep': 'k',
					},
				});
			},
			plain: () => {
				throw new GraphQLError('No http.', { extensions: { code: 'PLAIN' } });
			},
		},
	},
});

const refusing = definePlugin({
	name: 'refuse',
	onExecute({ state, setResult }) {
		state.set(httpRefusalKey, { status: 429, headers: { 'retry-after': '3' } });
		setResult({
			errors: [
				fail('Slow down.', {
					status: 503,
					headers: { 'retry-after': '99', 'x-e': '1' },
				}),
			],
		});
	},
});

const send = (
	app: { fetch(request: Request): Response | Promise<Response> },
	body: unknown,
	accept = 'application/json',
) =>
	Promise.resolve(
		app.fetch(
			new Request('http://x/graphql', {
				method: 'POST',
				headers: { 'content-type': 'application/json', accept },
				body: JSON.stringify(body),
			}),
		),
	);

const app = createGraxia({ schema, onUnexpected: false });
const q = (query: string) => ({ query });

describe('extensions.http on GraphQL errors', () => {
	test('a field error with status 409 answers 409 with its data', async () => {
		for (const accept of [
			'application/json',
			'application/graphql-response+json',
		]) {
			const res = await send(app, q('{ hello conflict }'), accept);
			expect(res.status).toBe(409);
			const body = (await res.json()) as any;
			expect(body.data).toEqual({ hello: 'world', conflict: null });
			expect(body.errors[0].extensions.code).toBe('X');
		}
	});

	test('the highest of several statuses wins', async () => {
		const res = await send(app, q('{ conflict many }'));
		expect(res.status).toBe(410);
	});

	test('the headers of the errors are merged', async () => {
		const res = await send(app, q('{ conflict many }'));
		expect(res.headers.get('x-conflict')).toBe('a');
		expect(res.headers.get('x-many')).toBe('1');
		expect(res.headers.get('content-type')).toContain('application/json');
	});

	test('http is stripped from the serialized extensions', async () => {
		const body = (await (await send(app, q('{ conflict }'))).json()) as any;
		expect(body.errors[0].extensions).toEqual({ code: 'X' });
		expect(JSON.stringify(body)).not.toContain('"http"');
	});

	test('http alone leaves no extensions key', async () => {
		const bare = createGraxia({
			schema: createSchema()({
				typeDefs: 'type Query { a: String }',
				resolvers: {
					Query: {
						a: () => {
							throw new GraphQLError('Only http.', {
								extensions: { http: { status: 404 } },
							});
						},
					},
				},
			}),
		});
		const res = await send(bare, q('{ a }'));
		expect(res.status).toBe(404);
		const body = (await res.json()) as any;
		expect(body.errors[0]).not.toHaveProperty('extensions');
	});

	test('spec: true ignores the status under application/json only, headers still apply', async () => {
		const legacy = await send(app, q('{ spec }'));
		expect(legacy.status).toBe(200);
		expect(legacy.headers.get('x-spec')).toBe('1');
		const strict = await send(
			app,
			q('{ spec }'),
			'application/graphql-response+json',
		);
		expect(strict.status).toBe(400);
	});

	test('an invalid status or header is ignored', async () => {
		const res = await send(app, q('{ bad }'));
		expect(res.status).toBe(200);
		expect(res.headers.get('x-ok')).toBe('y');
	});

	test('an error without http keeps the status of the media type', async () => {
		expect((await send(app, q('{ plain }'))).status).toBe(200);
		expect(
			(await send(app, q('{ plain }'), 'application/graphql-response+json'))
				.status,
		).toBe(200);
	});

	test('a masked unexpected error carrying http has no effect', async () => {
		const res = await send(app, q('{ sneaky }'));
		expect(res.status).toBe(200);
		const text = await res.text();
		expect(text).not.toContain('418');
		expect(text).not.toContain('secret detail');
	});

	test('a custom masker that keeps http is honoured', async () => {
		const keeping = createGraxia({
			schema,
			onUnexpected: false,
			maskError: (error) =>
				new GraphQLError('Masked.', {
					path: error.path,
					extensions: { code: 'M', http: { status: 502 } },
				}),
		});
		const res = await send(keeping, q('{ sneaky }'));
		expect(res.status).toBe(502);
		expect(JSON.stringify(await res.json())).not.toContain('"http"');
	});

	test('a plugin refusal wins over the status of the errors, their headers merge under its own', async () => {
		const guarded = createGraxia({ schema, plugins: [refusing] });
		const res = await send(guarded, q('{ hello }'));
		expect(res.status).toBe(429);
		expect(res.headers.get('retry-after')).toBe('3');
		expect(res.headers.get('x-e')).toBe('1');
	});

	test('a batch is unaffected', async () => {
		const batched = createGraxia({
			schema,
			batching: true,
			onUnexpected: false,
		});
		const res = await send(batched, [q('{ conflict }'), q('{ hello }')]);
		expect(res.status).toBe(200);
		expect(res.headers.get('x-conflict')).toBeNull();
	});

	test('errorHttp: false turns it off', async () => {
		const off = createGraxia({ schema, errorHttp: false });
		const res = await send(off, q('{ conflict }'));
		expect(res.status).toBe(200);
		expect(res.headers.get('x-conflict')).toBeNull();
		const body = (await res.json()) as any;
		expect(body.errors[0].extensions.http.status).toBe(409);
	});

	test('errorHttp must be true or false', () => {
		expect(() =>
			createGraxia({
				schema,
				errorHttp: 'no' as unknown as boolean,
			}),
		).toThrow('errorHttp must be true or false');
	});

	test('exposedError with extensions.http, the documented path', async () => {
		const res = await send(app, q('{ exposed }'));
		expect(res.status).toBe(409);
		const body = (await res.json()) as any;
		expect(body.errors[0].extensions).toEqual({
			code: 'CONFLICT',
			fix: 'Sign in.',
		});
	});

	test('on a header clash the later error wins', async () => {
		const res = await send(app, q('{ conflict later }'));
		expect(res.status).toBe(409);
		expect(res.headers.get('x-conflict')).toBe('b');
	});

	test('outcome.status wins over the errors', async () => {
		const setting = createGraxia({
			schema,
			plugins: [
				definePlugin({
					name: 'status',
					onExecute({ setResult, state }) {
						state.set(httpRefusalKey, { status: 451 });
						setResult({ errors: [fail('Nope.', { status: 500 })] });
					},
				}),
			],
		});
		expect((await send(setting, q('{ hello }'))).status).toBe(451);
	});

	test('plugin headers win over the errors headers', async () => {
		const guarded = createGraxia({
			schema,
			onUnexpected: false,
			plugins: [
				definePlugin({
					name: 'cors',
					onRequest({ responseHeaders }) {
						responseHeaders.set(
							'access-control-allow-origin',
							'https://app.test',
						);
						responseHeaders.set('cache-control', 'no-store');
					},
				}),
			],
		});
		const res = await send(guarded, q('{ conflict }'));
		expect(res.status).toBe(409);
		expect(res.headers.get('x-conflict')).toBe('a');
		expect(res.headers.get('access-control-allow-origin')).toBe(
			'https://app.test',
		);
		expect(res.headers.get('cache-control')).toBe('no-store');
	});

	test('an error cannot set framing headers, content-encoding included', async () => {
		const res = await send(app, q('{ encoded }'));
		expect(res.status).toBe(418);
		expect(res.headers.get('x-keep')).toBe('k');
		expect(res.headers.get('content-encoding')).toBeNull();
		expect(((await res.json()) as any).errors[0].message).toBe('Encoded.');
	});

	test('plain-object errors from a plugin setResult answer 409 and lose http', async () => {
		const plain = createGraxia({
			schema,
			plugins: [
				definePlugin({
					name: 'plain',
					onExecute({ setResult }) {
						setResult({
							errors: [
								{
									message: 'Plain.',
									extensions: { code: 'P', http: { status: 409 } },
								},
							],
						} as never);
					},
				}),
			],
		});
		const res = await send(plain, q('{ hello }'));
		expect(res.status).toBe(409);
		const body = (await res.json()) as any;
		expect(body.errors[0]).toEqual({
			message: 'Plain.',
			extensions: { code: 'P' },
		});
	});

	test('a batch entry has no http in its extensions', async () => {
		const batched = createGraxia({
			schema,
			batching: true,
			onUnexpected: false,
		});
		const res = await send(batched, [q('{ conflict }')]);
		const text = await res.text();
		expect(text).toContain('Taken.');
		expect(text).not.toContain('"http"');
		const kept = createGraxia({ schema, batching: true, errorHttp: false });
		expect(await (await send(kept, [q('{ conflict }')])).text()).toContain(
			'"http"',
		);
	});

	test('an SSE next event has no http in its extensions', async () => {
		const res = await send(app, q('{ conflict }'), 'text/event-stream');
		const text = await res.text();
		expect(text).toContain('Taken.');
		expect(text).not.toContain('"http"');
	});

	test('a WebSocket next message has no http in its extensions', async () => {
		const { url } = start({ schema });
		const c = createClient({ url, webSocketImpl: WebSocket, retryAttempts: 0 });
		const seen: unknown[] = [];
		await new Promise<void>((resolve, reject) =>
			c.subscribe(
				{ query: '{ conflict }' },
				{ next: (v) => seen.push(v), error: reject, complete: resolve },
			),
		);
		await c.dispose();
		expect(JSON.stringify(seen)).toContain('Taken.');
		expect(JSON.stringify(seen)).not.toContain('"http"');
	});

	test("an onResponse plugin's header wins over the errors' headers", async () => {
		const late = createGraxia({
			schema,
			onUnexpected: false,
			plugins: [
				definePlugin({
					name: 'late',
					onResponse({ state }) {
						state.responseHeaders.set('x-conflict', 'plugin');
						state.responseHeaders.set('cache-control', 'no-store');
					},
				}),
			],
		});
		const res = await send(late, q('{ conflict }'));
		expect(res.status).toBe(409);
		expect(res.headers.get('x-conflict')).toBe('plugin');
		expect(res.headers.get('cache-control')).toBe('no-store');
	});

	test('a deferred payload has no http in its extensions', async () => {
		const res = await send(
			app,
			q('{ hello ... @defer { conflict } }'),
			'text/event-stream',
		);
		const text = await res.text();
		expect(text).toContain('Taken.');
		expect(text).not.toContain('"http"');
	});
});
