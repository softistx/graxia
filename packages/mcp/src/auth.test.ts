import { describe, expect, test } from 'bun:test';
import {
	authed,
	bearer,
	fetchAs,
	META,
	RESOURCE,
	seen,
} from './auth.test-util';
import { call, mcpFor, rpc } from './fixtures.test-util';
import { createMcp } from './index';

describe('protected resource metadata', () => {
	const { mcp } = authed();
	test('path insertion from the resource URL', () => {
		expect(mcp.metadataPath).toBe('/.well-known/oauth-protected-resource/mcp');
	});
	test('GET returns the document with CORS and a cache hint', async () => {
		const response = mcp.metadata(new Request(`http://x${mcp.metadataPath}`));
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			resource: RESOURCE,
			authorization_servers: ['https://auth.example.com'],
			scopes_supported: ['mcp:read', 'mcp:write'],
			bearer_methods_supported: ['header'],
			resource_name: 'Library',
			resource_documentation: 'https://docs.example.com',
		});
		expect(response.headers.get('access-control-allow-origin')).toBe('*');
		expect(response.headers.get('cache-control')).toBe('max-age=3600');
	});
	test('another method is 405, a preflight 204', () => {
		const post = mcp.metadata(new Request('http://x/m', { method: 'POST' }));
		expect(post.status).toBe(405);
		expect(post.headers.get('allow')).toContain('GET');
		expect(
			mcp.metadata(new Request('http://x/m', { method: 'OPTIONS' })).status,
		).toBe(204);
	});
	test('custom scope names are published', async () => {
		const { mcp: m } = authed({
			auth: {
				resource: 'https://api.example.com/',
				authorizationServers: ['https://a'],
				verifyToken: () => undefined,
				scopes: { read: 'r', write: 'w' },
			},
		});
		expect(m.metadataPath).toBe('/.well-known/oauth-protected-resource');
		const body = await m.metadata(new Request('http://x/m')).json();
		expect(body.scopes_supported).toEqual(['r', 'w']);
		expect(body.resource_name).toBeUndefined();
	});
	test('mutations off: only the read scope is published', async () => {
		const { mcp: m } = authed({ mutations: false });
		const body = await m.metadata(new Request('http://x/m')).json();
		expect(body.scopes_supported).toEqual(['mcp:read']);
	});
	test('without auth: no path, 404', () => {
		const { mcp: plain } = mcpFor();
		expect(plain.metadataPath).toBeUndefined();
		expect(plain.metadata(new Request('http://x/m')).status).toBe(404);
	});
	test('a bad resource or an empty server list fails at createMcp', () => {
		const { graxia } = mcpFor();
		const auth = {
			authorizationServers: ['https://a'],
			verifyToken: () => undefined,
		};
		expect(() =>
			createMcp(graxia, { name: 'x', auth: { ...auth, resource: 'nope' } }),
		).toThrow(/absolute URL/);
		expect(() =>
			createMcp(graxia, {
				name: 'x',
				auth: { ...auth, resource: RESOURCE, authorizationServers: [] },
			}),
		).toThrow(/authorizationServers is empty/);
	});
	test.each([`${RESOURCE}#frag`, `${RESOURCE}?tenant=a`, `${RESOURCE}?`])(
		'a resource with a query or a fragment (%s) fails at createMcp',
		(resource) => {
			const { graxia } = mcpFor();
			expect(() =>
				createMcp(graxia, {
					name: 'x',
					auth: {
						resource,
						authorizationServers: ['https://a'],
						verifyToken: () => undefined,
					},
				}),
			).toThrow('createMcp: auth.resource must have no query and no fragment');
		},
	);
	test('an authorization server that is not an absolute URL fails at createMcp', () => {
		const { graxia } = mcpFor();
		expect(() =>
			createMcp(graxia, {
				name: 'x',
				auth: {
					resource: RESOURCE,
					authorizationServers: ['https://a', 'auth.example.com'],
					verifyToken: () => undefined,
				},
			}),
		).toThrow(
			'createMcp: auth.authorizationServers must hold absolute URLs (got "auth.example.com")',
		);
	});
});

describe('the bearer gate', () => {
	const { mcp } = authed();
	test('no token: 401 with the exact challenge', async () => {
		const response = await mcp.fetch(rpc('tools/list'));
		expect(response.status).toBe(401);
		expect(response.headers.get('www-authenticate')).toBe(
			`Bearer resource_metadata="${META}", scope="mcp:read"`,
		);
		const body = await response.json();
		expect(body.error.data.code).toBe('MCP_UNAUTHORIZED');
		expect(body.error.data.fix).toContain(META);
	});
	test('a token in the query string: 400, even with a header', async () => {
		const request = new Request('http://localhost/mcp?access_token=read', {
			method: 'POST',
			headers: { 'content-type': 'application/json', ...bearer('read') },
			body: '{}',
		});
		const response = await mcp.fetch(request);
		expect(response.status).toBe(400);
		expect((await response.json()).error.data.code).toBe('MCP_TOKEN_IN_URL');
	});
	test.each(['unknown', 'expired', 'other'])(
		'%s token: 401 invalid_token',
		async (token) => {
			const response = await fetchAs(mcp, token);
			expect(response.status).toBe(401);
			const header = response.headers.get('www-authenticate') ?? '';
			expect(header).toContain('error="invalid_token"');
			expect(header).toContain(`resource_metadata="${META}"`);
			expect((await response.json()).error.data.fix).toBeString();
		},
	);
	test('a throwing verifier: 503 with Retry-After and onError, not a 401', async () => {
		seen.errors.length = 0;
		const response = await fetchAs(mcp, 'boom');
		expect(response.status).toBe(503);
		expect(response.headers.get('retry-after')).toBe('5');
		expect(response.headers.has('www-authenticate')).toBe(false);
		const body = await response.json();
		expect(body.error.message).toContain('could not be verified');
		expect(body.error.data.fix).toBe(
			'Retry in a few seconds with the same token. If it persists, the server owner should read the error onError received. A verifier that throws for an invalid token must resolve undefined instead.',
		);
		expect(seen.errors.map(String)).toEqual(['Error: introspection down']);
	});
	test('the audience matches the resource ignoring a trailing slash', async () => {
		expect((await fetchAs(mcp, 'aud')).status).toBe(200);
	});
	test('a token without the read scope: 403 insufficient_scope', async () => {
		const response = await fetchAs(mcp, 'write');
		expect(response.status).toBe(403);
		expect(response.headers.get('www-authenticate')).toBe(
			`Bearer error="insufficient_scope", error_description="the token lacks mcp:read", resource_metadata="${META}", scope="mcp:read"`,
		);
		expect((await response.json()).error.data.code).toBe(
			'MCP_INSUFFICIENT_SCOPE',
		);
	});
	test('a valid token reaches the tools', async () => {
		const { body } = await call(
			mcp,
			'graphql_query',
			{ query: '{ books { title } }' },
			bearer('read'),
		);
		expect(body.result.structuredContent).toEqual({
			data: { books: [{ title: 'Dune' }] },
		});
	});
	test('GET without a token is still the 405 (nothing to leak)', async () => {
		expect((await mcp.fetch(new Request('http://localhost/mcp'))).status).toBe(
			405,
		);
	});
});

test('without auth nothing changes: no token needed', async () => {
	const { mcp } = mcpFor();
	expect((await mcp.fetch(rpc('tools/list'))).status).toBe(200);
});
