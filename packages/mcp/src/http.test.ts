import { describe, expect, test } from 'bun:test';
import { call, mcpFor, rpc } from './fixtures.test-util';

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

	test('a body over graxia limits.bodyBytes is 413 with a fix, by header and by size', async () => {
		const { mcp } = mcpFor({}, { limits: { bodyBytes: 100 } });
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
		expect((await r.json()).error.data.fix).toContain('limits.bodyBytes');
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

	test('a failing transport is a 500 with a fix, and onError gets the cause', async () => {
		const errors: unknown[] = [];
		const { mcp } = mcpFor({ onError: (error) => errors.push(error) });
		const broken = new Request('http://localhost/mcp', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: new ReadableStream({
				start(controller) {
					controller.error(new Error('socket reset'));
				},
			}),
			// @ts-expect-error Bun needs duplex for stream bodies
			duplex: 'half',
		});
		const r = await mcp.fetch(broken);
		expect(r.status).toBe(500);
		expect((await r.json()).error.message).toBe(
			'The MCP server failed to handle the request.',
		);
		expect(String(errors[0])).toContain('socket reset');
	});

	test('a `can` that throws is a tool error, not a leak, and onError gets the cause', async () => {
		const errors: unknown[] = [];
		const { mcp } = mcpFor({
			onError: (error) => errors.push(error),
			can: () => {
				throw new Error('permission store down');
			},
		});
		const r = await call(mcp, 'graphql_query', { query: '{ books { id } }' });
		expect(r.result.isError).toBe(true);
		expect(JSON.stringify(r.body)).not.toContain('permission store down');
		expect(String(errors[0])).toContain('permission store down');
	});

	test('the view is not built on initialize or tools/list', async () => {
		let built = 0;
		const { mcp } = mcpFor({
			can: () => {
				built++;
				return () => true;
			},
		});
		await mcp.fetch(rpc('tools/list'));
		await mcp.fetch(rpc('initialize', {}));
		expect(built).toBe(0);
		await call(mcp, 'graphql_schema', {});
		expect(built).toBe(1);
	});

	test("serverContext reaches graxia's context builder, and a client header cannot forge it", async () => {
		let seen: unknown;
		const { mcp } = mcpFor(
			{},
			{
				context: (base: { serverContext: { tenant?: string } }) => {
					seen = base.serverContext.tenant;
					return {};
				},
			},
		);
		await call(
			mcp,
			'graphql_query',
			{ query: '{ books { id } }' },
			{ 'x-graxia-mcp-context': 'forged' },
		);
		expect(seen).toBeUndefined();
		const response = await mcp.fetch(
			rpc(
				'tools/call',
				{ name: 'graphql_query', arguments: { query: '{ books { id } }' } },
				{ 'x-graxia-mcp-context': 'forged' },
			),
			{ tenant: 't1' } as never,
		);
		await response.text();
		expect(seen).toBe('t1');
	});

	test('serverContext reaches `can`', async () => {
		let got: unknown;
		const { mcp } = mcpFor({
			can: (_r, sc) => {
				got = sc;
				return () => true;
			},
		});
		await mcp.fetch(
			rpc('tools/call', { name: 'graphql_schema', arguments: {} }),
			{ tenant: 't1' } as never,
		);
		expect(got).toEqual({ tenant: 't1' });
	});

	test('the modern protocol leg (2026-07-28) runs a tool with the same serverContext', async () => {
		let seen: unknown;
		const { mcp } = mcpFor(
			{},
			{
				context: (base: { serverContext: { tenant?: string } }) => {
					seen = base.serverContext.tenant;
					return {};
				},
			},
		);
		const version = '2026-07-28';
		const response = await mcp.fetch(
			new Request('http://localhost/mcp', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					accept: 'application/json, text/event-stream',
					'mcp-protocol-version': version,
					'mcp-method': 'tools/call',
					'mcp-name': 'graphql_query',
				},
				body: JSON.stringify({
					jsonrpc: '2.0',
					id: 1,
					method: 'tools/call',
					params: {
						name: 'graphql_query',
						arguments: { query: '{ books { title } }' },
						_meta: {
							'io.modelcontextprotocol/protocolVersion': version,
							'io.modelcontextprotocol/clientInfo': { name: 'c', version: '1' },
							'io.modelcontextprotocol/clientCapabilities': {},
						},
					},
				}),
			}),
			{ tenant: 't9' } as never,
		);
		const body = await response.text();
		expect(response.status).toBe(200);
		expect(body).toContain('Dune');
		expect(seen).toBe('t9');
	});
});
