import { describe, expect, test } from 'bun:test';
import { mcpFor, rpc } from './fixtures.test-util';

describe('origin, host and CORS', () => {
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

	test('DNS rebinding: a rebound host that is its own origin is 403 with a fix', async () => {
		const { mcp } = mcpFor();
		const rebound = (origin: string, host: string) =>
			new Request('http://evil.example:3000/mcp', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					accept: 'application/json, text/event-stream',
					origin,
					host,
				},
				body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
			});
		const bad = await mcp.fetch(
			rebound('http://evil.example:3000', 'evil.example:3000'),
		);
		expect(bad.status).toBe(403);
		expect((await bad.json()).error.data.fix).toContain('allowedHosts');
		const local = await mcp.fetch(
			new Request('http://127.0.0.1:3000/mcp', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					accept: 'application/json, text/event-stream',
					origin: 'http://127.0.0.1:3000',
				},
				body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
			}),
		);
		expect(local.status).toBe(200);
		const { mcp: hosted } = mcpFor({ allowedHosts: ['evil.example'] });
		expect(
			(
				await hosted.fetch(
					rebound('http://evil.example:3000', 'evil.example:3000'),
				)
			).status,
		).toBe(200);
	});

	test('CORS: an allowed origin gets its preflight and the headers; another gets a 403', async () => {
		const { mcp } = mcpFor({ allowedOrigins: ['https://app.example'] });
		const preflight = await mcp.fetch(
			new Request('http://localhost/mcp', {
				method: 'OPTIONS',
				headers: {
					origin: 'https://app.example',
					'access-control-request-method': 'POST',
				},
			}),
		);
		expect(preflight.status).toBe(204);
		expect(preflight.headers.get('access-control-allow-origin')).toBe(
			'https://app.example',
		);
		expect(preflight.headers.get('access-control-allow-methods')).toBe('POST');
		expect(preflight.headers.get('access-control-allow-headers')).toContain(
			'mcp-protocol-version',
		);
		expect(preflight.headers.get('vary')).toBe('Origin');
		const answer = await mcp.fetch(
			rpc('tools/list', {}, { origin: 'https://app.example' }),
		);
		expect(answer.headers.get('access-control-allow-origin')).toBe(
			'https://app.example',
		);
		const refused = await mcp.fetch(
			new Request('http://localhost/mcp', {
				method: 'OPTIONS',
				headers: { origin: 'https://evil.example' },
			}),
		);
		expect(refused.status).toBe(403);
		expect(refused.headers.get('access-control-allow-origin')).toBeNull();
		expect(
			(await mcp.fetch(rpc('tools/list'))).headers.get(
				'access-control-allow-origin',
			),
		).toBeNull();
	});
});
