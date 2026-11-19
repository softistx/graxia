import { describe, expect, test } from 'bun:test';
import { createGraxia, createSchema } from '@graxia/core';
import { call, mcpFor, rpc, typeDefs } from './fixtures.test-util';
import { createMcp, type McpAuthInfo, type McpOptions, mcpAuth } from './index';

const RESOURCE = 'https://api.example.com/mcp';
const META = 'https://api.example.com/.well-known/oauth-protected-resource/mcp';
const future = Math.floor(Date.now() / 1000) + 3600;

const tokens: Record<string, McpAuthInfo> = {
	read: {
		subject: 'u1',
		clientId: 'c1',
		scopes: ['mcp:read'],
		expiresAt: future,
	},
	both: { subject: 'u2', scopes: ['mcp:read', 'mcp:write'], expiresAt: future },
	write: { scopes: ['mcp:write'], expiresAt: future },
	expired: { scopes: ['mcp:read'], expiresAt: 1 },
	other: { scopes: ['mcp:read'], audience: 'https://other.example.com/mcp' },
	aud: { scopes: ['mcp:read'], audience: [`${RESOURCE}/`] },
};

const seen: { errors: unknown[]; verified: number } = {
	errors: [],
	verified: 0,
};

function authed(extra: Partial<McpOptions> = {}) {
	return mcpFor({
		mutations: true,
		onError: (e) => void seen.errors.push(e),
		auth: {
			resource: RESOURCE,
			authorizationServers: ['https://auth.example.com'],
			resourceName: 'Library',
			documentation: 'https://docs.example.com',
			verifyToken: (token) => {
				seen.verified++;
				if (token === 'boom') throw new Error('introspection down');
				return tokens[token];
			},
		},
		...extra,
	});
}
const parse = (text: string) =>
	JSON.parse(
		text.startsWith('event:')
			? (text.split('\n').find((l) => l.startsWith('data:')) ?? '').slice(5)
			: text,
	);
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const fetchAs = (
	mcp: { fetch(r: Request): Promise<Response> },
	token: string,
) => mcp.fetch(rpc('tools/list', {}, bearer(token)));

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
		).toThrow(/authorizationServers/);
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
	test('a throwing verifier: 401 and onError', async () => {
		seen.errors.length = 0;
		const response = await fetchAs(mcp, 'boom');
		expect(response.status).toBe(401);
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

describe('the principal', () => {
	test('can receives the verified info as its third argument', async () => {
		let received: McpAuthInfo | undefined;
		const { mcp } = authed({
			can: (_request, _ctx, auth) => {
				received = auth;
				return (permission) => permission === 'staff';
			},
		});
		await call(mcp, 'graphql_schema', { types: ['Book'] }, bearer('read'));
		expect(received?.subject).toBe('u1');
	});
	test('mcpAuth() is readable in graxia context builder, and undefined outside', async () => {
		const schema = createSchema()({
			typeDefs,
			resolvers: {
				Query: {
					books: () => [],
					boom: () => null,
					staffReport: () => null,
					book: () => null,
				},
			},
		});
		let inContext: unknown = 'unset';
		let inResolver: unknown = 'unset';
		const graxia = createGraxia({
			schema,
			context: () => {
				inContext = mcpAuth()?.subject;
				return {};
			},
		});
		(schema.getQueryType()?.getFields()['boom'] as any).resolve = () => {
			inResolver = mcpAuth()?.clientId;
			return 'x';
		};
		const mcp = createMcp(graxia, {
			name: 'x',
			auth: {
				resource: RESOURCE,
				authorizationServers: ['https://a'],
				verifyToken: (t) => tokens[t],
			},
		});
		await call(mcp, 'graphql_query', { query: '{ boom }' }, bearer('read'));
		expect(inContext).toBe('u1');
		expect(inResolver).toBe('c1');
		expect(mcpAuth()).toBeUndefined();
	});
	test('the Authorization header still reaches the context builder', async () => {
		const schema = createSchema()({
			typeDefs: 'type Query { a: Int }',
			resolvers: { Query: { a: () => 1 } },
		});
		let header = null as string | null;
		const graxia = createGraxia({
			schema,
			context: ({ request }: { request: Request }) => {
				header = request.headers.get('authorization');
				return {};
			},
		} as any);
		const mcp = createMcp(graxia, {
			name: 'x',
			auth: {
				resource: RESOURCE,
				authorizationServers: ['https://a'],
				verifyToken: (t) => tokens[t],
			},
		});
		await call(mcp, 'graphql_query', { query: '{ a }' }, bearer('read'));
		expect(header).toBe('Bearer read');
	});
});

describe('CORS', () => {
	test('a preflight needs no token, and the challenge header is exposed', async () => {
		const { mcp } = authed({ allowedOrigins: ['https://app.example'] });
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
		const denied = await mcp.fetch(
			rpc('tools/list', {}, { origin: 'https://app.example' }),
		);
		expect(denied.status).toBe(401);
		expect(denied.headers.get('access-control-expose-headers')).toContain(
			'www-authenticate',
		);
		expect(denied.headers.get('access-control-allow-origin')).toBe(
			'https://app.example',
		);
	});
});

test('without auth nothing changes: no token needed', async () => {
	const { mcp } = mcpFor();
	expect((await mcp.fetch(rpc('tools/list'))).status).toBe(200);
});
