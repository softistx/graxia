import { afterAll, expect, test } from 'bun:test';
import {
	Client,
	discoverOAuthProtectedResourceMetadata,
	extractWWWAuthenticateParams,
	StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { app } from './fixtures.test-util';
import { createMcp } from './index';

const { graxia } = app();
let mcp: ReturnType<typeof createMcp> | undefined;
const server = Bun.serve({
	port: 0,
	fetch: (req) => {
		const { pathname } = new URL(req.url);
		if (mcp?.metadataPath === pathname) return mcp.metadata(req);
		if (pathname === '/mcp')
			return mcp?.fetch(req) ?? new Response(null, { status: 503 });
		return new Response(null, { status: 404 });
	},
});
const base = `http://localhost:${server.port}`;
mcp = createMcp(graxia, {
	name: 'library',
	mutations: true,
	auth: {
		resource: `${base}/mcp`,
		authorizationServers: ['https://auth.example.com'],
		verifyToken: (token) =>
			token === 'good'
				? { scopes: ['mcp:read', 'mcp:write'], subject: 'u1' }
				: undefined,
	},
});
afterAll(async () => {
	await server.stop(true);
	await mcp?.close();
});

test('a real client with a bearer header lists tools and calls one', async () => {
	const client = new Client({ name: 'test', version: '0.0.0' });
	await client.connect(
		new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
			requestInit: { headers: { authorization: 'Bearer good' } },
		}),
	);
	const { tools } = await client.listTools();
	expect(tools.map((t) => t.name)).toContain('graphql_mutate');
	const result = await client.callTool({
		name: 'graphql_query',
		arguments: { query: '{ books { title } }' },
	});
	expect(result.structuredContent).toEqual({
		data: { books: [{ title: 'Dune' }] },
	});
	await client.close();
});

test('a client without a token is challenged and discovers the metadata', async () => {
	const refused = await fetch(`${base}/mcp`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			accept: 'application/json, text/event-stream',
		},
		body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
	});
	expect(refused.status).toBe(401);
	const params = extractWWWAuthenticateParams(refused);
	expect(params.scope).toBe('mcp:read');
	const metadata = await discoverOAuthProtectedResourceMetadata(`${base}/mcp`, {
		resourceMetadataUrl: params.resourceMetadataUrl as URL,
	});
	expect(metadata.resource).toBe(`${base}/mcp`);
	expect(metadata.authorization_servers).toEqual(['https://auth.example.com']);
});

test('the client SDK refuses to connect without a token', async () => {
	const client = new Client({ name: 'test', version: '0.0.0' });
	await expect(
		client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`))),
	).rejects.toThrow();
});
