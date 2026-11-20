import {
	createGraxia,
	createSchema,
	type TrustedManifest,
} from '@softistx/graxia';
import type { Can as CoreCan } from '@softistx/graxia/agent';
import {
	type Can,
	createMcp,
	type Mcp,
	type McpAuthInfo,
	type McpOperationInfo,
	type McpOperationsOptions,
	mcpAuth,
} from './index';

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
// With `auth` the metadata path is a string: a route key, with no cast.
const path: string = secured.metadataPath;
const doc: Response = secured.metadata(new Request('http://x'));
Bun.serve({
	routes: {
		[secured.metadataPath]: secured.metadata,
		'/mcp': (request, server) => secured.fetch(request, { server }),
	},
});
void path;
void doc;
// Without `auth` it is undefined.
// @ts-expect-error no auth, no metadata path
const none: string = a.metadataPath;
void none;
// The verifier may answer with its own Response, and take over the audience check.
createMcp(plain, {
	name: 'x',
	auth: {
		resource: 'https://api.example.com/mcp',
		authorizationServers: ['https://auth.example.com'],
		audience: 'verifier',
		verifyToken: (token) =>
			token === 'x' ? new Response(null, { status: 401 }) : { scopes: [] },
	},
});
createMcp(plain, {
	name: 'x',
	auth: {
		resource: 'r',
		authorizationServers: [],
		verifyToken: () => undefined,
		// @ts-expect-error audience is 'resource' or 'verifier'
		audience: 'none',
	},
});
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

// operations: core's TrustedManifest in its three formats, include and descriptions typed.
{
	const codegen: Record<string, string> = { a: 'query A { a }' };
	createMcp(plain, { name: 'x', operations: { documents: codegen } });
	createMcp(plain, {
		name: 'x',
		genericTools: false,
		operations: {
			documents: new Map([['a', 'query A { a }']]),
			include: (operation) => {
				const kind: 'query' | 'mutation' = operation.kind;
				const text: string = operation.name + operation.id;
				return kind === 'query' && text !== '';
			},
			descriptions: { A: 'Reads a.' },
		},
	});
	createMcp(plain, {
		name: 'x',
		operations: {
			documents: {
				format: 'apollo-persisted-query-manifest',
				version: 1,
				operations: [{ id: 'a', body: 'query A { a }' }],
			},
		},
	});
	// An Apollo manifest imported from JSON: `format` is a string and `version` a number there.
	const imported: {
		format: string;
		version: number;
		operations: { id: string; body: string }[];
	} = { format: 'apollo-persisted-query-manifest', version: 1, operations: [] };
	createMcp(plain, { name: 'x', operations: { documents: imported } });
	// A hand-made host must say its trusted documents mode: leaving it out would fail open.
	createMcp(
		// @ts-expect-error trustedDocuments is required (a missing mode would switch strict off)
		{ execute: plain.execute, schema: plain.schema, limits: plain.limits },
		{ name: 'x', operations: { documents: codegen } },
	);
	createMcp(
		{
			execute: plain.execute,
			schema: plain.schema,
			limits: plain.limits,
			trustedDocuments: plain.trustedDocuments,
		},
		{ name: 'x', operations: { documents: codegen } },
	);
	// `can` is a factory returning core's `Can`.
	const can: Can = (permission) => permission === 'a';
	createMcp(plain, { name: 'x', can: () => can });
	// @ts-expect-error the factory returns a predicate, not a boolean
	createMcp(plain, { name: 'x', can: () => true });
	const mode: 'strict' | 'mixed' | undefined = plain.trustedDocuments?.mode;
	void mode;
	const manifest: TrustedManifest = codegen;
	const options: McpOperationsOptions = { documents: manifest };
	createMcp(plain, { name: 'x', operations: options });
	// @ts-expect-error documents is required
	createMcp(plain, { name: 'x', operations: {} });
	// @ts-expect-error documents is a manifest, not a list
	createMcp(plain, { name: 'x', operations: { documents: ['query A { a }'] } });
	createMcp(plain, {
		name: 'x',
		operations: {
			documents: codegen,
			// @ts-expect-error include returns a boolean
			include: (o: McpOperationInfo) => o.name,
		},
	});
	// @ts-expect-error genericTools is a boolean
	createMcp(plain, { name: 'x', genericTools: 'no' });
}

// The re-export is core's type.
const same: CoreCan = {} as Can;
void same;
