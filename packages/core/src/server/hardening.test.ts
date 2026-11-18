import { describe, expect, mock, test } from 'bun:test';
import type { ValidationRule } from 'graphql';
import { getRequestId } from '../http/request-id';
import { definePlugin } from '../plugins/define';
import { createGraxia } from './create-graxia';
import { schema } from './fixtures.test-util';

const post = (body: unknown, headers: HeadersInit = {}) =>
	new Request('http://x/graphql', {
		method: 'POST',
		headers: { 'content-type': 'application/json', ...headers },
		body: JSON.stringify(body),
	});

describe('validation', () => {
	test('a throwing rule still runs the onValidate after-hooks', async () => {
		const after = mock(() => {});
		const boom: ValidationRule = () => {
			throw new Error('rule exploded');
		};
		const g = createGraxia({
			schema,
			onUnexpected: false,
			plugins: [
				definePlugin()({
					name: 'p',
					onValidate: ({ addRule }) => {
						addRule(boom);
						return after;
					},
				}),
			],
		});
		const res = await g.fetch(post({ query: '{ hello }' }));
		expect(res.status).toBe(500);
		expect(after).toHaveBeenCalledTimes(1);
	});

	test('validation errors carry GRAPHQL_VALIDATION_FAILED', async () => {
		const g = createGraxia({ schema });
		const res = await g.fetch(post({ query: '{ nope }' }));
		const body = (await res.json()) as any;
		expect(body.errors[0].extensions.code).toBe('GRAPHQL_VALIDATION_FAILED');
		expect(body.errors[0].locations).toBeDefined();
		// served from the cache the second time, still coded
		const again = (await (
			await g.fetch(post({ query: '{ nope }' }))
		).json()) as any;
		expect(again.errors[0].extensions.code).toBe('GRAPHQL_VALIDATION_FAILED');
	});
});

describe('onResponse', () => {
	test('setResponse replaces the response; a returned function is ignored', async () => {
		const ignored = mock(() => {});
		const g = createGraxia({
			schema,
			plugins: [
				definePlugin()({
					name: 'p',
					// A JS caller can return a function; the type forbids it.
					onResponse: (({ setResponse }: any) => {
						setResponse(new Response('replaced', { status: 202 }));
						return ignored;
					}) as never,
				}),
			],
		});
		const res = await g.fetch(post({ query: '{ hello }' }));
		expect(res.status).toBe(202);
		expect(await res.text()).toBe('replaced');
		expect(ignored).not.toHaveBeenCalled();
	});
});

describe('request id', () => {
	test('an invalid incoming x-request-id is ignored; getRequestId gives the generated id', async () => {
		const seen: (string | undefined)[] = [];
		const g = createGraxia({
			schema,
			plugins: [
				definePlugin()({
					name: 'p',
					onRequest: ({ state }) => {
						seen.push(getRequestId(state));
					},
				}),
			],
		});
		const res = await g.fetch(
			post({ query: '{ hello }' }, { 'x-request-id': 'a bé \u0001' }),
		);
		expect(res.status).toBe(200);
		const id = res.headers.get('x-request-id') as string;
		expect(id).toMatch(/^[0-9a-f-]{36}$/);
		expect(seen).toEqual([id]);
	});

	test('fetch resolves even when a plugin answers a response Bun refuses', async () => {
		const g = createGraxia({
			schema,
			onUnexpected: false,
			plugins: [
				definePlugin()({
					name: 'p',
					onRequest: ({ respond }) => respond(Response.error()),
				}),
			],
		});
		const res = await g.fetch(post({ query: '{ hello }' }));
		expect(res.status).toBe(500);
	});
});

describe('deeply nested documents', () => {
	test('a stack overflow is GRAPHQL_PARSE_FAILED, not masked', async () => {
		const g = createGraxia({
			schema,
			limits: { nesting: false, tokens: false },
		});
		const deep = `${'['.repeat(200_000)}${']'.repeat(200_000)}`;
		const res = await g.fetch(post({ query: `{ hello(x: ${deep}) }` }));
		const body = (await res.json()) as any;
		expect(body.errors[0].extensions.code).toBe('GRAPHQL_PARSE_FAILED');
		expect(body.errors[0].message).not.toBe('Unexpected error.');
	});
});

describe('setup failure', () => {
	test('ready rejects, onUnexpected reports once, onDispose skips the failed plugin', async () => {
		const disposed: string[] = [];
		const onUnexpected = mock(
			(_error: unknown, _info: { phase: string }) => {},
		);
		const g = createGraxia({
			schema,
			onUnexpected,
			plugins: [
				definePlugin()({
					name: 'good',
					onDispose: () => {
						disposed.push('good');
					},
				}),
				definePlugin()({
					name: 'bad',
					setup: () => {
						throw new Error('no connection');
					},
					onDispose: () => {
						disposed.push('bad');
					},
				}),
			],
		});
		await expect(g.ready).rejects.toThrow('bad');
		await g.fetch(post({ query: '{ hello }' }));
		await g.dispose();
		const setups = onUnexpected.mock.calls.filter(
			([, info]) => info.phase === 'setup',
		);
		expect(setups).toHaveLength(1);
		expect(disposed).toEqual(['good']);
	});

	test('ready resolves when every setup succeeds', async () => {
		const g = createGraxia({ schema });
		await expect(g.ready).resolves.toBeUndefined();
	});
});
