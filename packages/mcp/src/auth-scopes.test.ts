import { describe, expect, test } from 'bun:test';
import { authed, bearer, parse } from './auth.test-util';
import { call, rpc } from './fixtures.test-util';

describe('write scope', () => {
	const { mcp } = authed();
	const names = async (token: string) => {
		const r = await mcp.fetch(rpc('tools/list', {}, bearer(token)));
		return parse(await r.text()).result.tools.map(
			(t: { name: string }) => t.name,
		);
	};
	test('read-only token: graphql_mutate is not listed', async () => {
		expect(await names('read')).toEqual(['graphql_schema', 'graphql_query']);
	});
	test('read+write token: it is listed and works', async () => {
		expect(await names('both')).toContain('graphql_mutate');
		const { result } = await call(
			mcp,
			'graphql_mutate',
			{ query: 'mutation { rename(id: "1", title: "X") { title } }' },
			bearer('both'),
		);
		expect(result.structuredContent.data.rename.title).toBe('X');
	});
	test('read-only token calling it (a stale list): 403 step-up with both scopes', async () => {
		const response = await mcp.fetch(
			rpc(
				'tools/call',
				{
					name: 'graphql_mutate',
					arguments: {
						query: 'mutation { rename(id: "1", title: "X") { title } }',
					},
				},
				bearer('read'),
			),
		);
		expect(response.status).toBe(403);
		const header = response.headers.get('www-authenticate') ?? '';
		expect(header).toContain('error="insufficient_scope"');
		expect(header).toContain('scope="mcp:read mcp:write"');
		expect((await response.json()).error.data.code).toBe(
			'MCP_INSUFFICIENT_SCOPE',
		);
	});
	test('the same call inside a batch: 403 step-up too', async () => {
		const message = (id: number, name: string) => ({
			jsonrpc: '2.0',
			id,
			method: 'tools/call',
			params: { name, arguments: { query: '{ books { title } }' } },
		});
		const response = await mcp.fetch(
			new Request('http://localhost/mcp', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					accept: 'application/json, text/event-stream',
					...bearer('read'),
				},
				body: JSON.stringify([
					message(1, 'graphql_query'),
					message(2, 'graphql_mutate'),
				]),
			}),
		);
		expect(response.status).toBe(403);
		expect(response.headers.get('www-authenticate')).toContain(
			'scope="mcp:read mcp:write"',
		);
	});
	test('mutations off: a read token calling it gets tool-not-found, not a 403', async () => {
		const { mcp: m } = authed({ mutations: false });
		const { response, body } = await call(
			m,
			'graphql_mutate',
			{ query: 'mutation { rename(id: "1", title: "X") { title } }' },
			bearer('read'),
		);
		expect(response.status).not.toBe(403);
		expect(response.headers.has('www-authenticate')).toBe(false);
		expect(body.error).toEqual({
			code: -32602,
			message: 'Tool graphql_mutate not found',
		});
	});
	test('a mutation sent to graphql_query: the fix names the write scope', async () => {
		const { result } = await call(
			mcp,
			'graphql_query',
			{ query: 'mutation { rename(id: "1", title: "X") { title } }' },
			bearer('read'),
		);
		expect(result.structuredContent.errors[0].extensions.fix).toContain(
			'and the token has the scope mcp:write',
		);
	});
	test('the schema overview does not advertise mutations to a read-only token', async () => {
		const { result } = await call(mcp, 'graphql_schema', {}, bearer('read'));
		expect(JSON.stringify(result.content)).not.toContain('rename');
		const both = await call(mcp, 'graphql_schema', {}, bearer('both'));
		expect(JSON.stringify(both.result.content)).toContain('rename');
	});
	test('mutations: false stays false for a write token', async () => {
		const { mcp: m } = authed({ mutations: false });
		const r = await m.fetch(rpc('tools/list', {}, bearer('both')));
		expect(parse(await r.text()).result.tools).toHaveLength(2);
	});
});
