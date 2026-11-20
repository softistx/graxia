import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { createSchema } from '../schema/create-schema';
import { createGraxia } from '../server/create-graxia';
import type { ContextInit } from '../server/options';

const json = { 'content-type': 'application/json' };
const post = (url: string, query: string, headers: HeadersInit = {}) =>
	new Request(url, {
		method: 'POST',
		headers: { ...json, ...headers },
		body: JSON.stringify({ query }),
	});

const seen: object[] = [];

const schema = createSchema()({
	typeDefs: `
		type Query { hello: String a: Int b: Int pack: Pack }
		type Pack { c: Int }
	`,
	resolvers: {
		Query: {
			hello: () => 'world',
			a: (_: unknown, __: unknown, ctx: object) => seen.push(ctx),
			b: (_: unknown, __: unknown, ctx: object) => seen.push(ctx),
			pack: () => ({}),
		},
		Pack: { c: (_: unknown, __: unknown, ctx: object) => seen.push(ctx) },
	},
});

const loginSchema = createSchema<{ set: Headers }>()({
	typeDefs: 'type Query { login: Boolean }',
	resolvers: {
		Query: {
			login: (_: unknown, __: unknown, ctx) => {
				ctx.set.append('set-cookie', 'session=abc; HttpOnly; SameSite=Lax');
				ctx.set.set('cache-control', 'no-store');
				return true;
			},
		},
	},
});

describe('a host owns the server', () => {
	test('a prefixed path is served, the bare one is 404', async () => {
		const graxia = createGraxia({ schema, path: '/api/graphql' });
		const query = '{ hello }';
		const there = await graxia.fetch(post('http://x/api/graphql', query));
		expect(await there.json()).toEqual({ data: { hello: 'world' } });
		const bare = await graxia.fetch(post('http://x/graphql', query));
		expect(bare.status).toBe(404);
	});

	test('a resolver sets a header and a cookie through the host context', async () => {
		const graxia = createGraxia({
			schema: loginSchema,
			context: ({ serverContext }: ContextInit<{ set: Headers }>) => ({
				set: serverContext.set,
			}),
		});
		const set = new Headers();
		const response = await graxia.fetch(post('http://x/graphql', '{ login }'), {
			set,
		});
		// the host merges what resolvers set into the response it sends
		for (const [name, value] of set) response.headers.append(name, value);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(response.headers.getSetCookie()).toEqual([
			'session=abc; HttpOnly; SameSite=Lax',
		]);
		expect(await response.json()).toEqual({ data: { login: true } });
	});

	test('CORS is left to the host: no access-control header, OPTIONS is 405', async () => {
		const graxia = createGraxia({ schema });
		const answered = await graxia.fetch(
			post('http://x/graphql', '{ hello }', {
				origin: 'https://other.example',
			}),
		);
		expect(answered.status).toBe(200);
		expect(
			[...answered.headers.keys()].filter((name) =>
				name.startsWith('access-control-'),
			),
		).toEqual([]);
		const preflight = await graxia.fetch(
			new Request('http://x/graphql', {
				method: 'OPTIONS',
				headers: {
					origin: 'https://other.example',
					'access-control-request-method': 'POST',
				},
			}),
		);
		expect(preflight.status).toBe(405);
		expect(preflight.headers.get('allow')).toBeTruthy();
		expect(preflight.headers.get('access-control-allow-origin')).toBeNull();
	});

	test('one context object per operation, deferred fields included', async () => {
		seen.length = 0;
		const graxia = createGraxia({ schema });
		const query = '{ a b ... @defer { pack { c } } }';
		const response = await graxia.fetch(
			post('http://x/graphql', query, { accept: 'multipart/mixed' }),
		);
		await response.text();
		expect(seen).toHaveLength(3);
		expect(new Set(seen).size).toBe(1);
		const again = await graxia.fetch(post('http://x/graphql', '{ a }'));
		await again.text();
		expect(seen).toHaveLength(4);
		expect(seen[3]).not.toBe(seen[0]);
	});
});

describe('quiet logs', () => {
	const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;
	const spies = methods.map((method) => ({ method, spy: undefined as any }));
	beforeEach(() => {
		for (const entry of spies) entry.spy = spyOn(console, entry.method);
	});
	afterEach(() => {
		for (const entry of spies) entry.spy.mockRestore();
	});

	test('requests write nothing to the console', async () => {
		const graxia = createGraxia({ schema, limits: { bodyBytes: 200 } });
		const ok = await graxia.fetch(post('http://x/graphql', '{ hello }'));
		const parse = await graxia.fetch(post('http://x/graphql', '{ hello'));
		const csrf = await graxia.fetch(
			new Request('http://x/graphql?query=%7Bhello%7D'),
		);
		const big = await graxia.fetch(
			post('http://x/graphql', `{ hello }${' '.repeat(400)}`),
		);
		expect([ok.status, parse.status, csrf.status, big.status]).toEqual([
			200, 200, 403, 413,
		]);
		expect((await parse.json()).errors).toBeDefined();
		for (const { method, spy } of spies)
			expect(spy.mock.calls, `console.${method}`).toHaveLength(0);
	});
});
