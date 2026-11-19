import { createGraxia, createSchema } from '@graxia/core';
import { createMcp, type Mcp, type McpAuthInfo, mcpAuth } from './index';

const schema = createSchema()({
	typeDefs: 'type Query { a: Int }',
	resolvers: { Query: { a: () => 1 } },
});

// No host context: `serverContext` is optional.
const plain = createGraxia({ schema });
const a = createMcp(plain, { name: 'x' });
a.fetch(new Request('http://x'));
a.fetch(new Request('http://x'), {});

// A host context with a required key: `serverContext` is required and typed, and so is `can`'s.
const hosted = createGraxia<{ tenant: string }>({
	schema,
	context: () => ({}),
});
const b: Mcp<{ tenant: string }> = createMcp(hosted, {
	name: 'x',
	version: '1',
	instructions: 'i',
	mutations: true,
	allowedOrigins: ['https://a'],
	allowedHosts: ['mcp.example'],
	onError: false,
	can: async (request, serverContext) => {
		const tenant: string = serverContext.tenant;
		const method: string = request.method;
		return (permission) => permission === `${tenant}${method}`;
	},
});
b.fetch(new Request('http://x'), { tenant: 't' });
// @ts-expect-error serverContext is required
b.fetch(new Request('http://x'));
// @ts-expect-error tenant must be a string
b.fetch(new Request('http://x'), { tenant: 1 });

// @ts-expect-error name is required
createMcp(plain, {});
// @ts-expect-error the schema comes from graxia
createMcp(plain, { name: 'x', schema });
// @ts-expect-error the body limit comes from graxia
createMcp(plain, { name: 'x', maxBodyBytes: 10 });
// @ts-expect-error mutations is a boolean
createMcp(plain, { name: 'x', mutations: 'yes' });
createMcp(plain, { name: 'x', onError: (error: unknown) => void error });

// The documented mount: `{ server }` is accepted as the server context.
Bun.serve({
	routes: { '/mcp': (request, server) => a.fetch(request, { server }) },
	fetch: plain.fetch,
});

// OAuth: `auth` needs the resource, the issuers and a verifier; the rest is optional.
const secured = createMcp(plain, {
	name: 'x',
	auth: {
		resource: 'https://api.example.com/mcp',
		authorizationServers: ['https://auth.example.com'],
		verifyToken: async (token, request) => {
			const length: number = token.length + request.url.length;
			return length > 0
				? {
						subject: 's',
						clientId: 'c',
						scopes: ['mcp:read'],
						expiresAt: 1,
						audience: ['https://api.example.com/mcp'],
						extra: { tenant: 't' },
					}
				: undefined;
		},
		scopes: { read: 'r', write: 'w' },
		resourceName: 'x',
		documentation: 'https://docs',
	},
	can: (_request, _serverContext, auth) => {
		const subject: string | undefined = auth?.subject;
		return () => subject !== undefined;
	},
});
const path: string | undefined = secured.metadataPath;
const doc: Response = secured.metadata(new Request('http://x'));
void path;
void doc;
// @ts-expect-error the verifier and the resource are required
createMcp(plain, { name: 'x', auth: { authorizationServers: [] } });
createMcp(plain, {
	name: 'x',
	auth: {
		resource: 'r',
		authorizationServers: [],
		// @ts-expect-error scopes must be a list
		verifyToken: () => ({ scopes: 'mcp:read' }),
	},
});

// mcpAuth() reads the verified principal; it is not a promise.
const principal: McpAuthInfo | undefined = mcpAuth();
const granted: readonly string[] = principal?.scopes ?? [];
void granted;
