import { describe, expect, test } from 'bun:test';
import { own } from '../http/own-response';
import { definePlugin } from '../plugins/define';
import { StateBag } from '../plugins/state';
import type { GraxiaPlugin } from '../plugins/types';
import { createGraxia } from './create-graxia';
import { schema } from './fixtures.test-util';
import { seal } from './seal';

const q = () =>
	new Request('http://x/graphql', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ query: '{ hello }' }),
	});
const make = (...plugins: GraxiaPlugin<any, any>[]) =>
	createGraxia({ schema, plugins });

describe('seal', () => {
	test('an immutable response is rebuilt with the id and the plugin headers', async () => {
		const g = make(
			definePlugin({
				name: 'p',
				onRequest: ({ responseHeaders }) => responseHeaders.set('x-p', '1'),
				onResponse: ({ setResponse }) =>
					setResponse(Response.redirect('http://x/', 302)),
			}),
		);
		const res = await g.fetch(q());
		expect(res.status).toBe(302);
		expect(res.headers.get('x-request-id')).toBeTruthy();
		expect(res.headers.get('x-p')).toBe('1');
	});
	test('vary and set-cookie append, a header already present is kept', async () => {
		const g = make(
			definePlugin({
				name: 'p',
				onRequest: ({ responseHeaders }) => {
					responseHeaders.append('vary', 'Origin');
					responseHeaders.append('set-cookie', 'a=1');
					responseHeaders.set('cache-control', 'public');
					responseHeaders.set('x-new', 'n');
				},
				onResponse: ({ setResponse }) =>
					setResponse(
						new Response('x', {
							headers: { 'cache-control': 'no-store', vary: 'Cookie' },
						}),
					),
			}),
		);
		const res = await g.fetch(q());
		expect(res.headers.get('cache-control')).toBe('no-store');
		expect(res.headers.get('x-new')).toBe('n');
		expect(res.headers.get('vary')).toContain('Cookie');
		expect(res.headers.get('vary')).toContain('Origin');
		expect(res.headers.getSetCookie()).toEqual(['a=1']);
	});
	test("a plugin's x-request-id never wins", async () => {
		const g = make(
			definePlugin({
				name: 'p',
				onRequest: ({ responseHeaders }) =>
					responseHeaders.set('x-request-id', 'forged'),
			}),
		);
		for (const _ of [1, 2]) {
			const res = await g.fetch(q());
			expect(res.headers.get('x-request-id')).not.toBe('forged');
			expect(res.headers.get('x-request-id')).toBeTruthy();
		}
	});
	test('a plugin returning the same Response twice gets independent headers and the object is untouched', async () => {
		const shared = new Response('ok', { headers: { 'x-own': 'yes' } });
		const g = make(
			definePlugin({
				name: 'p',
				onRequest: ({ responseHeaders, request }) =>
					responseHeaders.set(
						'x-seen',
						new URL(request.url).searchParams.get('n') ?? '',
					),
				onResponse: ({ setResponse }) => setResponse(shared),
			}),
		);
		const a = await g.fetch(new Request('http://x/graphql?n=1', q()));
		const b = await g.fetch(new Request('http://x/graphql?n=2', q()));
		expect(a.headers.get('x-seen')).toBe('1');
		expect(b.headers.get('x-seen')).toBe('2');
		expect(a.headers.get('x-request-id')).not.toBe(
			b.headers.get('x-request-id'),
		);
		expect(shared.headers.has('x-request-id')).toBe(false);
		expect(shared.headers.has('x-seen')).toBe(false);
	});
	test('a response graxia built is sealed in place, once per request', async () => {
		const g = make();
		const a = await g.fetch(q());
		const b = await g.fetch(q());
		expect(a.headers.get('x-request-id')).not.toBe(
			b.headers.get('x-request-id'),
		);
		expect(a.status).toBe(200);
	});
	test('a plugin caching the response it sees in onResponse does not leak headers across requests', async () => {
		let cached: Response | undefined;
		let n = 0;
		const g = make(
			definePlugin({
				name: 'p',
				onRequest: ({ responseHeaders }) =>
					responseHeaders.append('set-cookie', `session=user${++n}`),
				onResponse: ({ response, setResponse }) => {
					cached ??= response;
					setResponse(cached);
				},
			}),
		);
		await g.fetch(q());
		const second = await g.fetch(q());
		expect(second.headers.getSetCookie()).toEqual(['session=user2']);
	});
	test('the same through an onRequest after-hook', async () => {
		let cached: Response | undefined;
		let n = 0;
		const g = make(
			definePlugin({
				name: 'p',
				onRequest: ({ responseHeaders, respond }) => {
					responseHeaders.append('set-cookie', `session=user${++n}`);
					if (cached) respond(cached);
					return ({ response }) => {
						cached ??= response;
					};
				},
			}),
		);
		await g.fetch(q());
		const second = await g.fetch(q());
		expect(second.headers.getSetCookie()).toEqual(['session=user2']);
	});
	test('a response graxia built is the object that comes back; any other is rebuilt', () => {
		const state = new StateBag();
		const mine = own(new Response('x'));
		expect(seal(mine, state)).toBe(mine);
		const other = new Response('x');
		expect(seal(other, state)).not.toBe(other);
		expect(seal(mine, state)).not.toBe(mine);
	});
});
