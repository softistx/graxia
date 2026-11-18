import { describe, expect, test } from 'bun:test';
import { raw, start } from '../ws/ws.test-util';
import { fieldRateLimit } from './plugin';
import { counter } from './rate-limit.test-util';

describe('over a real server', () => {
	test('the default key is the address serve() read', async () => {
		const c = counter(10);
		const { url } = start({
			plugins: [fieldRateLimit({ fields: { hello: c.limit } })],
		});
		const response = await fetch(url.replace('ws:', 'http:'), {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ query: '{ hello }' }),
		});
		expect(response.status).toBe(200);
		expect(c.calls[0]?.key).toMatch(
			/^hello:(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/,
		);
	});

	test('WebSocket: an error message, with the connection address as key', async () => {
		const c = counter(0);
		const { url } = start({
			plugins: [fieldRateLimit({ fields: { hello: c.limit } })],
		});
		const client = raw(url);
		await client.init();
		await client.send({
			id: '1',
			type: 'subscribe',
			payload: { query: '{ hello }' },
		});
		const message = await client.next();
		expect(message.type).toBe('error');
		expect(message.payload[0].extensions).toEqual({
			code: 'RATE_LIMITED',
			retryAfter: 3,
		});
		expect(c.calls[0]?.key).toMatch(/^hello:.*(127\.0\.0\.1|::1)/);
	});
});
