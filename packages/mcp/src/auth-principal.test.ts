import { describe, expect, test } from 'bun:test';
import { createGraxia, createSchema } from '@softistx/graxia';
import { authed, bearer, RESOURCE, tokens } from './auth.test-util';
import { call, mcpFor, rpc, typeDefs } from './fixtures.test-util';
import { createMcp, type McpAuthInfo, mcpAuth } from './index';

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
	test('an instance without auth, called inside a tool call, sees no principal', async () => {
		let nested: unknown = 'unset';
		const inner = mcpFor(
			{},
			{
				context: () => {
					nested = mcpAuth();
					return {};
				},
			},
		).mcp;
		const schema = createSchema()({
			typeDefs: 'type Query { a: String }',
			resolvers: {
				Query: {
					a: async () => {
						await call(inner, 'graphql_query', {
							query: '{ books { title } }',
						});
						return mcpAuth()?.subject;
					},
				},
			},
		});
		const outer = createMcp(createGraxia({ schema }), {
			name: 'x',
			auth: {
				resource: RESOURCE,
				authorizationServers: ['https://a'],
				verifyToken: (t) => tokens[t],
			},
		});
		const { result } = await call(
			outer,
			'graphql_query',
			{ query: '{ a }' },
			bearer('read'),
		);
		expect(result.structuredContent).toEqual({ data: { a: 'u1' } });
		expect(nested).toBeUndefined();
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
