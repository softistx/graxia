import { describe, expect, spyOn, test } from 'bun:test';
import {
	createGraxia,
	createSchema,
	GraxiaConfigError,
} from '@softistx/graxia';
import { resolveAuth } from './auth/resolve';
import { sinkOf } from './create';
import { call, mcpFor } from './fixtures.test-util';
import { createMcp } from './index';

const strict = { trustedDocuments: { manifest: {}, mode: 'strict' } } as const;

describe('boot errors are GraxiaConfigError', () => {
	const base = {
		resource: 'https://api.example.com/mcp',
		authorizationServers: ['https://auth.example.com'],
		verifyToken: () => undefined,
	};
	test('every auth problem', () => {
		for (const bad of [
			{ ...base, resource: 'nope' },
			{ ...base, resource: 'https://api.example.com/mcp?x=1' },
			{ ...base, authorizationServers: [] },
			{ ...base, authorizationServers: ['nope'] },
		])
			expect(() => resolveAuth(bad)).toThrow(GraxiaConfigError);
	});
});

describe('strict trusted documents with no typed tool', () => {
	test('reports once at boot through onError', () => {
		const errors: unknown[] = [];
		mcpFor({ onError: (e) => errors.push(e) }, strict);
		expect(errors).toHaveLength(1);
		expect(errors[0]).toBeInstanceOf(GraxiaConfigError);
		expect((errors[0] as Error).message).toContain('operations: { documents }');
	});
	test('says nothing without strict, or with typed tools', () => {
		const errors: unknown[] = [];
		const onError = (e: unknown) => errors.push(e);
		mcpFor({ onError });
		mcpFor({ onError }, { trustedDocuments: { manifest: {}, mode: 'mixed' } });
		mcpFor(
			{
				onError,
				operations: {
					documents: { a: '"""All books.""" query Books { books { id } }' },
				},
			},
			strict,
		);
		expect(errors).toEqual([]);
	});
});

describe('allowedHosts and allowedOrigins that can never match', () => {
	const refused = (extra: Record<string, unknown>) => {
		try {
			mcpFor(extra);
		} catch (error) {
			expect(error).toBeInstanceOf(GraxiaConfigError);
			return (error as Error).message;
		}
		throw new Error('createMcp did not throw');
	};
	test('a host with a port, a scheme or a path', () => {
		expect(refused({ allowedHosts: ['mcp.example.com:3000'] })).toContain(
			'Fix: use "mcp.example.com".',
		);
		expect(refused({ allowedHosts: ['https://mcp.example.com'] })).toContain(
			'use "mcp.example.com"',
		);
		expect(refused({ allowedHosts: ['mcp.example.com/mcp'] })).toContain(
			'use "mcp.example.com"',
		);
		expect(refused({ allowedHosts: ['[::1]:3000'] })).toContain('use "[::1]"');
	});
	test('an origin with a trailing slash or a path', () => {
		expect(refused({ allowedOrigins: ['https://app.example/'] })).toContain(
			'use "https://app.example"',
		);
		expect(
			refused({ allowedOrigins: ['https://app.example:8443/app'] }),
		).toContain('use "https://app.example:8443"');
		expect(refused({ allowedOrigins: ['app.example'] })).toContain(
			'scheme://host',
		);
	});
	test('exact entries boot', () => {
		mcpFor({
			allowedHosts: ['mcp.example.com', '[::1]', 'localhost'],
			allowedOrigins: ['https://app.example', 'http://localhost:5173'],
		});
	});
});

describe('the default onError filter', () => {
	test('skips the SDK "Rejected" protocol mistakes and reports the rest', () => {
		const spy = spyOn(console, 'error').mockImplementation(() => {});
		try {
			const sink = sinkOf(undefined);
			sink(new Error('Rejected unknown method'));
			expect(spy).not.toHaveBeenCalled();
			const other = new Error('db down');
			sink(other);
			expect(spy).toHaveBeenCalledTimes(1);
			expect(spy.mock.calls[0]?.[1]).toBe(other);
		} finally {
			spy.mockRestore();
		}
	});
});

describe('can shapes the view, not the objects behind an abstract field', () => {
	const schema = createSchema()({
		typeDefs: /* GraphQL */ `
			directive @needs(permission: String, anyOf: [String!]) repeatable on OBJECT | FIELD_DEFINITION
			interface Node { id: ID! }
			type Public implements Node { id: ID! }
			type Secret implements Node @needs(permission: "staff") { id: ID! }
			type Query { """Nodes.""" nodes: [Node!]! }
		`,
		resolvers: {
			Node: { __resolveType: (n: { kind: string }) => n.kind },
			Query: {
				nodes: () => [
					{ kind: 'Public', id: '1' },
					{ kind: 'Secret', id: '2' },
				],
			},
		},
	});
	test('a hidden type is still returned through the interface field', async () => {
		const graxia = createGraxia({ schema });
		const mcp = createMcp(graxia, { name: 'x', can: () => () => false });
		const r = await call(mcp, 'graphql_query', {
			query: '{ nodes { __typename id } }',
		});
		expect(r.result.structuredContent.data.nodes).toEqual([
			{ __typename: 'Public', id: '1' },
			{ __typename: 'Secret', id: '2' },
		]);
		const named = await call(mcp, 'graphql_query', {
			query: '{ nodes { ... on Secret { id } } }',
		});
		expect(named.result.isError).toBe(true);
	});
});
