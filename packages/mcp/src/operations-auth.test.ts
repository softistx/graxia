import { describe, expect, test } from 'bun:test';
import { createGraxia, createSchema } from '@graxia/core';
import { authed, bearer, RESOURCE, tokens } from './auth.test-util';
import { call, rpc } from './fixtures.test-util';
import { createMcp, mcpAuth } from './index';
import { listed, manifest } from './operations.test-util';

const operations = { documents: manifest };

describe('scopes of the typed tools', () => {
	const { mcp } = authed({ operations });
	test('a read token lists the query tools, not the mutation tool', async () => {
		const tools = await listed(mcp, rpc('tools/list', {}, bearer('read')));
		const names = tools.map((t) => t.name);
		expect(names).toContain('book_by_id');
		expect(names).not.toContain('rename_book');
		expect(names).not.toContain('graphql_mutate');
	});
	test('a write token lists and runs the mutation tool', async () => {
		const tools = await listed(mcp, rpc('tools/list', {}, bearer('both')));
		expect(tools.map((t) => t.name)).toContain('rename_book');
		const r = await call(
			mcp,
			'rename_book',
			{ id: '1', title: 'Messiah' },
			bearer('both'),
		);
		expect(r.result.structuredContent.data.rename.title).toBe('Messiah');
	});
	test('a read token runs a query tool', async () => {
		const r = await call(mcp, 'book_by_id', { id: '1' }, bearer('read'));
		expect(r.result.structuredContent.data.book.title).toBe('Dune');
	});
	test('a read token calling a mutation tool gets the 403 step-up', async () => {
		const { response, body } = await call(
			mcp,
			'rename_book',
			{ id: '1', title: 'x' },
			bearer('read'),
		);
		expect(response.status).toBe(403);
		const challenge = response.headers.get('www-authenticate') ?? '';
		expect(challenge).toContain('error="insufficient_scope"');
		expect(challenge).toContain('scope="mcp:read mcp:write"');
		expect(challenge).toContain('rename_book needs the scope mcp:write');
		expect(body.error.data.code).toBe('MCP_INSUFFICIENT_SCOPE');
	});
	test('mutations off: the mutation tool is not found, no 403', async () => {
		const { mcp: m } = authed({ operations, mutations: false });
		const { response, body } = await call(
			m,
			'rename_book',
			{ id: '1', title: 'x' },
			bearer('read'),
		);
		expect(response.status).not.toBe(403);
		expect(body.error.message).toBe('Tool rename_book not found');
	});
	test('no token: a 401 before any tool', async () => {
		const { response } = await call(mcp, 'book_by_id', { id: '1' });
		expect(response.status).toBe(401);
	});
});

test('mcpAuth() is the verified token inside the context builder of a typed tool', async () => {
	const schema = createSchema<{ subject: string | undefined }>()({
		typeDefs: 'type Query { me: String }',
		resolvers: { Query: { me: (_p, _a, context) => context.subject } },
	});
	const graxia = createGraxia({
		schema,
		context: () => ({ subject: mcpAuth()?.subject }),
	});
	const mcp = createMcp(graxia, {
		name: 'x',
		genericTools: false,
		operations: { documents: { m: '"""Who I am.""" query Me { me }' } },
		auth: {
			resource: RESOURCE,
			authorizationServers: ['https://a'],
			verifyToken: (t) => tokens[t],
		},
	});
	const r = await call(mcp, 'me', {}, bearer('read'));
	expect(r.result.structuredContent).toEqual({ data: { me: 'u1' } });
});
