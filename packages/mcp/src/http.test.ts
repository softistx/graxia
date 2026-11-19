import { describe, expect, test } from 'bun:test';
import { mcpFor, rpc } from './fixtures.test-util';

describe('transport', () => {
	test('GET and DELETE are 405 with Allow and a fix', async () => {
		const { mcp } = mcpFor();
		for (const method of ['GET', 'DELETE']) {
			const r = await mcp.fetch(
				new Request('http://localhost/mcp', { method }),
			);
			expect(r.status).toBe(405);
			expect(r.headers.get('allow')).toBe('POST');
			expect((await r.json()).error.data.fix).toContain('POST');
		}
	});

	test('an Origin of another site is 403 with a fix; no Origin, same origin and allowed pass', async () => {
		const { mcp } = mcpFor({ allowedOrigins: ['https://app.example'] });
		const bad = await mcp.fetch(
			rpc('tools/list', {}, { origin: 'https://evil.example' }),
		);
		expect(bad.status).toBe(403);
		expect((await bad.json()).error.data.fix).toContain('allowedOrigins');
		for (const origin of ['http://localhost', 'https://app.example'])
			expect((await mcp.fetch(rpc('tools/list', {}, { origin }))).status).toBe(
				200,
			);
		expect((await mcp.fetch(rpc('tools/list'))).status).toBe(200);
	});

	test('a body over maxBodyBytes is 413 with a fix, by header and by size', async () => {
		const { mcp } = mcpFor({ maxBodyBytes: 100 });
		const big = JSON.stringify({
			jsonrpc: '2.0',
			id: 1,
			method: 'tools/list',
			pad: 'x'.repeat(200),
		});
		const headers = {
			'content-type': 'application/json',
			accept: 'application/json, text/event-stream',
		};
		const r = await mcp.fetch(
			new Request('http://localhost/mcp', {
				method: 'POST',
				headers,
				body: big,
			}),
		);
		expect(r.status).toBe(413);
		expect((await r.json()).error.data.fix).toContain('maxBodyBytes');
		const stream = new Request('http://localhost/mcp', {
			method: 'POST',
			headers,
			body: new ReadableStream({
				start(c) {
					c.enqueue(new TextEncoder().encode(big));
					c.close();
				},
			}),
			// @ts-expect-error Bun needs duplex for stream bodies
			duplex: 'half',
		});
		expect((await mcp.fetch(stream)).status).toBe(413);
	});

	test('a non-JSON content type is 415 with a fix', async () => {
		const { mcp } = mcpFor();
		const r = await mcp.fetch(
			new Request('http://localhost/mcp', {
				method: 'POST',
				headers: { 'content-type': 'text/plain' },
				body: '{}',
			}),
		);
		expect(r.status).toBe(415);
		expect((await r.json()).error.data.fix).toContain('application/json');
	});

	test('a bad maxBodyBytes throws at creation', () => {
		expect(() => mcpFor({ maxBodyBytes: 0 })).toThrow('maxBodyBytes');
	});

	test('serverContext reaches `can`', async () => {
		let got: unknown;
		const { mcp } = mcpFor({
			can: (_r, sc) => {
				got = sc;
				return () => true;
			},
		});
		await mcp.fetch(rpc('tools/list'), { tenant: 't1' } as never);
		expect(got).toEqual({ tenant: 't1' });
	});
});
