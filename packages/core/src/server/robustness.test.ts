import { describe, expect, spyOn, test } from 'bun:test';
import { definePlugin } from '../plugins/define';
import { createStateKey } from '../plugins/state';
import type { GraxiaPlugin } from '../plugins/types';
import { createGraxia } from './create-graxia';
import { schema } from './fixtures.test-util';

const json = { 'content-type': 'application/json' };
const post = (body: unknown, headers: HeadersInit = json) =>
	new Request('http://x/graphql', {
		method: 'POST',
		headers,
		body: typeof body === 'string' ? body : JSON.stringify(body),
	});
const q = (query: string) => post({ query });
const generic = (res: Response) => ({
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
const make = (plugins: GraxiaPlugin<any, any>[], extra: object = {}) =>
	createGraxia({ schema, plugins, onUnexpected: false, ...extra });

describe('fetch never rejects', () => {
	test('a plugin answering Response.error() becomes a 500', async () => {
		const g = make([
			definePlugin({
				name: 'p',
				onRequest: ({ respond }) => respond(Response.error()),
			}),
		]);
		const res = await g.fetch(q('{ hello }'));
		expect(res.status).toBe(500);
		expect(await res.json()).toEqual(generic(res));
		expect(res.headers.get('x-request-id')).toBeTruthy();
	});
	test('onResponse setResponse(Response.error()) becomes a 500', async () => {
		const g = make([
			definePlugin({
				name: 'p',
				onResponse: ({ setResponse }) => setResponse(Response.error()),
			}),
		]);
		expect((await g.fetch(q('{ hello }'))).status).toBe(500);
	});
});

type Counts = Record<string, number>;
const counting = (counts: Counts) => {
	const bump = (name: string) => () => {
		counts[name] = (counts[name] ?? 0) + 1;
	};
	return definePlugin({
		name: 'counter',
		enforce: 'pre',
		onRequest: () => bump('request'),
		onParams: () => bump('params'),
		onExecute: () => bump('execute'),
	});
};

describe('after-hooks run exactly once on every path', () => {
	const cases: [
		string,
		GraxiaPlugin<any, any>[],
		() => Request,
		Partial<Counts>,
		number,
		object?,
	][] = [
		[
			'onRequest respond',
			[
				definePlugin({
					name: 'b',
					onRequest: ({ respond }) => respond(new Response('x')),
				}),
			],
			() => q('{ hello }'),
			{ request: 1 },
			200,
		],
		[
			'413',
			[],
			() => q(`{ hello }${' '.repeat(300)}`),
			{ request: 1 },
			413,
			{ limits: { bodyBytes: 100 } },
		],
		[
			'hook error',
			[
				definePlugin({
					name: 'b',
					onExecute: () => {
						throw new Error('x');
					},
				}),
			],
			() => q('{ hello }'),
			{ request: 1, params: 1, execute: 1 },
			500,
		],
		[
			'thrown context',
			[],
			() => q('{ hello }'),
			{ request: 1, params: 1 },
			500,
			{
				context: () => {
					throw new Error('x');
				},
			},
		],
		[
			'thrown executeFn',
			[
				definePlugin({
					name: 'b',
					onExecute: ({ setExecuteFn }) =>
						setExecuteFn(() => {
							throw new Error('x');
						}),
				}),
			],
			() => q('{ hello }'),
			{ request: 1, params: 1, execute: 1 },
			500,
		],
		[
			'onResponse setResponse',
			[
				definePlugin({
					name: 'b',
					onResponse: ({ setResponse }) =>
						setResponse(new Response('y', { status: 201 })),
				}),
			],
			() => q('{ hello }'),
			{ request: 1, params: 1, execute: 1 },
			201,
		],
		[
			'onResponse hook error',
			[
				definePlugin({
					name: 'b',
					onResponse: () => {
						throw new Error('x');
					},
				}),
			],
			() => q('{ hello }'),
			{ request: 1, params: 1, execute: 1 },
			500,
		],
		[
			'onParams respond',
			[
				definePlugin({
					name: 'b',
					onParams: ({ respond }) =>
						respond(new Response('x', { status: 202 })),
				}),
			],
			() => q('{ hello }'),
			{ request: 1, params: 1 },
			202,
		],
	];
	test.each(cases)(
		'%s',
		async (_name, plugins, request, expected, status, extra) => {
			const counts: Counts = {};
			const g = make([counting(counts), ...plugins], extra);
			const res = await g.fetch(request());
			expect(res.status).toBe(status);
			expect({ request: 0, params: 0, execute: 0, ...counts }).toEqual({
				request: 0,
				params: 0,
				execute: 0,
				...expected,
			});
		},
	);
});

describe('batching under failure', () => {
	const batching = { limit: 5 };
	test('a failing entry becomes a generic error and the batch carries on after a mutation ran', async () => {
		const bumps = 0;
		let n = 0;
		const g = make(
			[
				definePlugin({
					name: 'p',
					onExecute: ({ args, setExecuteFn }) => {
						n++;
						if (n === 2)
							setExecuteFn(() => {
								throw new Error('boom');
							});
						void args;
					},
				}),
			],
			{ batching },
		);
		void bumps;
		const res = await g.fetch(
			post([
				{ query: 'mutation { bump }' },
				{ query: '{ hello }' },
				{ query: '{ hello }' },
			]),
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual([
			{ data: { bump: 1 } },
			generic(res),
			{ data: { hello: 'world' } },
		]);
	});
	test('an onParams respond answers the whole request', async () => {
		let n = 0;
		const g = make(
			[
				definePlugin({
					name: 'p',
					onParams: ({ respond }) => {
						if (++n === 2) respond(new Response('stop', { status: 429 }));
					},
				}),
			],
			{ batching },
		);
		const res = await g.fetch(
			post([{ query: '{ hello }' }, { query: '{ hello }' }]),
		);
		expect(res.status).toBe(429);
	});
	test('entries have isolated state, and read the request state', async () => {
		const key = createStateKey<string>('k');
		const reqKey = createStateKey<string>('r');
		const seen: (string | undefined)[] = [];
		const g = make(
			[
				definePlugin({
					name: 'p',
					onRequest: ({ state }) => state.set(reqKey, 'req'),
					onParams: ({ state }) => {
						seen.push(state.get(key), state.get(reqKey));
						state.set(key, 'entry');
					},
				}),
			],
			{ batching },
		);
		await g.fetch(post([{ query: '{ hello }' }, { query: '{ hello }' }]));
		expect(seen).toEqual([undefined, 'req', undefined, 'req']);
	});
});

describe('response headers', () => {
	test('negotiated responses vary by Accept; plugin vary is appended', async () => {
		const g = make([
			definePlugin({
				name: 'p',
				onRequest: ({ responseHeaders }) =>
					responseHeaders.append('vary', 'Origin'),
			}),
		]);
		const res = await g.fetch(q('{ hello }'));
		expect(res.headers.get('vary')).toContain('Accept');
		expect(res.headers.get('vary')).toContain('Origin');
	});
	test('a plugin cannot override content-type; set-cookie stacks', async () => {
		const g = make([
			definePlugin({
				name: 'p',
				onRequest: ({ responseHeaders }) => {
					responseHeaders.set('content-type', 'text/plain');
					responseHeaders.append('set-cookie', 'a=1');
					responseHeaders.append('set-cookie', 'b=2');
				},
			}),
		]);
		const res = await g.fetch(q('{ hello }'));
		expect(res.headers.get('content-type')).toContain('application/json');
		expect(res.headers.getSetCookie()).toEqual(['a=1', 'b=2']);
	});
});

describe('operation selection and executors', () => {
	test('a GET mutation is 405 before validation', async () => {
		const g = make([]);
		const url = `http://x/graphql?query=${encodeURIComponent('mutation { doesNotExist }')}`;
		const res = await g.fetch(
			new Request(url, { headers: { 'x-graphql-csrf': '1' } }),
		);
		expect(res.status).toBe(405);
		expect(res.headers.get('allow')).toBe('POST');
	});
	test('an executor returning an incremental result is released then refused', async () => {
		let released = false;
		const stream = {
			next: async () => ({ done: true as const, value: undefined }),
			return: async () => {
				released = true;
				return { done: true as const, value: undefined };
			},
			[Symbol.asyncIterator]() {
				return this;
			},
		};
		const g = make([
			definePlugin({
				name: 'p',
				onExecute: ({ setResult }) =>
					setResult({
						initialResult: { data: null, pending: [] },
						subsequentResults: stream,
					} as never),
			}),
		]);
		const res = await g.fetch(
			post(
				{ query: '{ hello }' },
				{ ...json, accept: 'application/graphql-response+json' },
			),
		);
		expect(res.status).toBe(400);
		expect(JSON.stringify(await res.json())).toContain(
			'INCREMENTAL_NOT_SUPPORTED',
		);
		expect(released).toBe(true);
	});
	test('serve forwards the Bun server in the context', async () => {
		let seen: unknown;
		const g = make([
			definePlugin({
				name: 'p',
				onContext: ({ context }) => {
					seen = (context as { server?: unknown }).server;
				},
			}),
		]);
		const server = g.serve({ port: 0 });
		try {
			await fetch(`http://localhost:${server.port}/graphql`, {
				method: 'POST',
				headers: json,
				body: '{"query":"{ hello }"}',
			});
			expect(seen).toBe(server);
		} finally {
			await server.stop(true);
		}
	});
});

describe('onUnexpected', () => {
	test('receives the original error and the request id; the body stays generic', async () => {
		const calls: { error: unknown; requestId: string | undefined }[] = [];
		const boom = new Error('secret');
		const g = createGraxia({
			schema,
			onUnexpected: (error, { requestId }) => calls.push({ error, requestId }),
			plugins: [
				definePlugin({
					name: 'p',
					onExecute: () => {
						throw boom;
					},
				}),
			],
		});
		const res = await g.fetch(q('{ hello }'));
		expect(await res.json()).toEqual(generic(res));
		expect(calls).toHaveLength(1);
		expect(calls[0]?.error).toBe(boom);
		expect(calls[0]?.requestId).toBe(res.headers.get('x-request-id') as string);
	});
	test('defaults to console.error outside production; a throwing reporter is harmless', async () => {
		const spy = spyOn(console, 'error').mockImplementation(() => {});
		try {
			const plugins = [
				definePlugin({
					name: 'p',
					onExecute: () => {
						throw new Error('x');
					},
				}),
			];
			await createGraxia({ schema, plugins }).fetch(q('{ hello }'));
			expect(spy).toHaveBeenCalledTimes(1);
			const bad = createGraxia({
				schema,
				plugins,
				onUnexpected: () => {
					throw new Error('reporter');
				},
			});
			expect((await bad.fetch(q('{ hello }'))).status).toBe(500);
		} finally {
			spy.mockRestore();
		}
	});
});
