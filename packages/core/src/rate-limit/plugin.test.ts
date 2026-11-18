import { describe, expect, test } from 'bun:test';
import { fieldRateLimit } from './plugin';
import { app, counter, post } from './rate-limit.test-util';

const limited = (max: number, extra: object = {}, host = {}) => {
	const c = counter(max);
	return {
		...c,
		graxia: app(
			fieldRateLimit({ fields: { signIn: c.limit }, key: () => 'k', ...extra }),
			host,
		),
	};
};

describe('refusal', () => {
	test('429 with Retry-After, no-store, code and retryAfter seconds', async () => {
		const { graxia } = limited(1);
		const response = await post(graxia, { query: '{ a: signIn b: signIn }' });
		expect(response.status).toBe(429);
		expect(response.headers.get('retry-after')).toBe('3');
		expect(response.headers.get('cache-control')).toBe('no-store');
		const body = (await response.json()) as any;
		expect(body.data).toBeUndefined();
		expect(body.errors[0].message).toBe('Too many requests, try again later.');
		expect(body.errors[0].extensions).toEqual({
			code: 'RATE_LIMITED',
			retryAfter: 3,
		});
	});
	test('a custom code', async () => {
		const { graxia } = limited(0, { code: 'SLOW_DOWN' });
		const body = (await (
			await post(graxia, { query: '{ signIn }' })
		).json()) as any;
		expect(body.errors[0].extensions.code).toBe('SLOW_DOWN');
	});
	test('retryAfter is at least 1 second, and 1 when not finite', async () => {
		for (const [retry, seconds] of [
			[10, 1],
			[Number.NaN, 1],
			[1001, 2],
		] as const) {
			const c = counter(0, retry);
			const graxia = app(
				fieldRateLimit({ fields: { signIn: c.limit }, key: () => 'k' }),
			);
			const response = await post(graxia, { query: '{ signIn }' });
			expect(response.headers.get('retry-after')).toBe(String(seconds));
		}
	});
	test('under the limit nothing changes', async () => {
		const { graxia } = limited(5);
		const response = await post(graxia, { query: '{ signIn }' });
		expect(response.status).toBe(200);
		expect(((await response.json()) as any).data).toEqual({ signIn: true });
	});
	test('a batch entry is an error, the batch stays 200 with no header', async () => {
		const { graxia } = limited(1, {}, { batching: { limit: 5 } });
		const response = await post(graxia, [
			{ query: '{ signIn }' },
			{ query: '{ signIn }' },
		]);
		expect(response.status).toBe(200);
		expect(response.headers.get('retry-after')).toBeNull();
		const body = (await response.json()) as any[];
		expect(body[0].data).toEqual({ signIn: true });
		expect(body[1].errors[0].extensions.code).toBe('RATE_LIMITED');
	});
	test('graxia.execute gets the error result', async () => {
		const { graxia } = limited(0);
		const result = await graxia.execute({ document: '{ signIn }' });
		expect(result.errors?.[0]?.extensions?.['code']).toBe('RATE_LIMITED');
	});
	test('over SSE it is an event, with no status or header', async () => {
		const { graxia } = limited(0);
		const response = await post(
			graxia,
			{ query: '{ signIn }' },
			'text/event-stream',
		);
		expect(response.status).toBe(200);
		expect(response.headers.get('retry-after')).toBeNull();
		expect(await response.text()).toContain('RATE_LIMITED');
	});
});

describe('order and charge', () => {
	test('fields are charged in document order and spent units stay spent', async () => {
		const first = counter(10);
		const second = counter(0);
		const graxia = app(
			fieldRateLimit({
				fields: { hello: first.limit, signIn: second.limit },
				key: () => 'k',
			}),
		);
		const response = await post(graxia, { query: '{ hello signIn }' });
		expect(response.status).toBe(429);
		expect(first.calls).toEqual([{ key: 'hello:k', cost: 1 }]);
		expect(second.calls).toEqual([{ key: 'signIn:k', cost: 1 }]);
	});
	test('a subscription is counted once, at subscribe', async () => {
		const c = counter(0);
		const graxia = app(
			fieldRateLimit({ fields: { tick: c.limit }, key: () => 'k' }),
		);
		const response = await post(
			graxia,
			{ query: 'subscription { tick }' },
			'text/event-stream',
		);
		expect(await response.text()).toContain('RATE_LIMITED');
		expect(c.calls).toEqual([{ key: 'tick:k', cost: 1 }]);
	});
});

describe('keys', () => {
	test('ctx.ip, then ipv6Prefix', async () => {
		const c = counter(10);
		const graxia = app(
			fieldRateLimit({ fields: { signIn: c.limit }, ipv6Prefix: 64 }),
			{ context: () => ({ ip: '2001:db8:0:1::7' }) },
		);
		await post(graxia, { query: '{ signIn }' });
		expect(c.calls[0]?.key).toBe('signIn:2001:db8:0:1:0:0:0:0/64');
	});
	test('a custom key sees the context; undefined counts nothing', async () => {
		const c = counter(0);
		const graxia = app(
			fieldRateLimit({
				fields: { signIn: c.limit },
				key: async (ctx: { user?: string }) => ctx.user,
			}),
			{ context: () => ({ user: undefined }) },
		);
		const response = await post(graxia, { query: '{ signIn }' });
		expect(response.status).toBe(200);
		expect(c.calls).toEqual([]);
	});
	test('no address at all (fetch without a server) counts nothing', async () => {
		const c = counter(0);
		const graxia = app(fieldRateLimit({ fields: { signIn: c.limit } }));
		expect((await post(graxia, { query: '{ signIn }' })).status).toBe(200);
		expect(c.calls).toEqual([]);
	});
});
