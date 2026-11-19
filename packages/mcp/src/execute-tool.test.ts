import { describe, expect, test } from 'bun:test';
import { call, mcpFor, rpc } from './fixtures.test-util';

const first = (r: { result: { content: { text: string }[] } }) =>
	JSON.parse(r.result.content[0]?.text ?? '{}');

describe('graphql_query', () => {
	test('runs a query: structuredContent and its JSON text', async () => {
		const { mcp } = mcpFor();
		const r = await call(mcp, 'graphql_query', {
			query: 'query($id: ID!) { book(id: $id) { title } }',
			variables: { id: '1' },
			operationName: undefined,
		});
		expect(r.result.structuredContent).toEqual({
			data: { book: { title: 'Dune' } },
		});
		expect(first(r)).toEqual(r.result.structuredContent);
		expect(r.result.isError).toBeUndefined();
	});

	test('a hidden field is "Cannot query field", with a fix', async () => {
		const { mcp } = mcpFor({ can: () => () => false });
		const r = await call(mcp, 'graphql_query', { query: '{ staffReport }' });
		expect(r.result.isError).toBe(true);
		const [error] = r.result.structuredContent.errors;
		expect(error.message).toContain('Cannot query field "staffReport"');
		expect(error.extensions.code).toBe('GRAPHQL_VALIDATION_FAILED');
		expect(error.extensions.fix).toContain('graphql_schema');
	});

	test('the same field runs for a caller who holds the permission', async () => {
		const { mcp } = mcpFor({ can: () => () => true });
		const r = await call(mcp, 'graphql_query', { query: '{ staffReport }' });
		expect(r.result.structuredContent).toEqual({
			data: { staffReport: 'report' },
		});
	});

	test('a mutation is refused with a fix naming graphql_mutate', async () => {
		const { mcp } = mcpFor({ mutations: true });
		const r = await call(mcp, 'graphql_query', {
			query: 'mutation { rename(id: "1", title: "x") { id } }',
		});
		expect(r.result.isError).toBe(true);
		const [error] = r.result.structuredContent.errors;
		expect(error.extensions.fix).toContain('graphql_mutate');
		expect(error.extensions.code).toBe('MCP_OPERATION_NOT_ALLOWED');
	});

	test('introspection is refused: it would show what @needs hides', async () => {
		const { mcp } = mcpFor({ can: () => () => false });
		for (const query of [
			'{ __schema { types { name } } }',
			'{ __type(name: "Book") { fields { name } } }',
			'{ ...F } fragment F on Query { __schema { queryType { name } } }',
		]) {
			const r = await call(mcp, 'graphql_query', { query });
			expect(r.result.isError).toBe(true);
			const [error] = r.result.structuredContent.errors;
			expect(error.extensions.fix).toBe(
				'Use graphql_schema to read the schema.',
			);
		}
		const typename = await call(mcp, 'graphql_query', {
			query: '{ __typename }',
		});
		expect(typename.result.structuredContent).toEqual({
			data: { __typename: 'Query' },
		});
	});

	test('operationName picks the operation: a mixed document runs the selected one', async () => {
		const { mcp } = mcpFor();
		const query =
			'query Read { books { title } } mutation Write { rename(id: "1", title: "x") { id } }';
		const ok = await call(mcp, 'graphql_query', {
			query,
			operationName: 'Read',
		});
		expect(ok.result.structuredContent).toEqual({
			data: { books: [{ title: 'Dune' }] },
		});
		const bad = await call(mcp, 'graphql_query', {
			query,
			operationName: 'Write',
		});
		expect(bad.result.structuredContent.errors[0].extensions.code).toBe(
			'MCP_OPERATION_NOT_ALLOWED',
		);
	});

	test('a subscription is refused', async () => {
		const { mcp } = mcpFor();
		const r = await call(mcp, 'graphql_query', {
			query: 'subscription { ticks }',
		});
		const [error] = r.result.structuredContent.errors;
		expect(error.message).toBe('Subscriptions are not available over MCP.');
		expect(error.extensions.code).toBe('SUBSCRIPTION_NOT_SUPPORTED');
	});

	test('@defer and @stream are refused with a fix to remove them', async () => {
		const { mcp } = mcpFor();
		const r = await call(mcp, 'graphql_query', {
			query: '{ books { ... @defer { title } } }',
		});
		const [error] = r.result.structuredContent.errors;
		expect(error.message).toBe('@defer is not available over MCP.');
		expect(error.extensions.fix).toContain('Remove @defer');
		expect(error.extensions.code).toBe('INCREMENTAL_NOT_SUPPORTED');
		const s = await call(mcp, 'graphql_query', {
			query: '{ books @stream { id } }',
		});
		expect(s.result.structuredContent.errors[0].message).toContain('@stream');
	});

	test('a syntax error carries a fix', async () => {
		const { mcp } = mcpFor();
		const r = await call(mcp, 'graphql_query', { query: '{ books ' });
		const [error] = r.result.structuredContent.errors;
		expect(error.extensions.code).toBe('GRAPHQL_PARSE_FAILED');
		expect(error.extensions.fix).toContain('syntax');
	});

	test('a masked resolver error keeps graxia code and fix, and leaks nothing', async () => {
		const { mcp } = mcpFor({}, { onUnexpected: () => {} });
		const r = await call(mcp, 'graphql_query', { query: '{ boom }' });
		const text = JSON.stringify(r.result.structuredContent);
		expect(text).not.toContain('db password');
		const [error] = r.result.structuredContent.errors;
		expect(error.extensions.code).toBe('INTERNAL_SERVER_ERROR');
		expect(error.extensions.fix).toBe(
			'Retry later; quote the correlationId when you report it.',
		);
		expect(r.result.isError).toBeUndefined(); // data { boom: null } is present
	});

	test('graxia protections apply: an exposed error keeps its code and fix', async () => {
		const { mcp } = mcpFor({}, { limits: { depth: 1 } });
		const r = await call(mcp, 'graphql_query', {
			query: '{ books { title } }',
		});
		const [error] = r.result.structuredContent.errors;
		expect(typeof error.extensions.code).toBe('string');
		expect(typeof error.extensions.fix).toBe('string');
		expect(r.result.isError).toBe(true);
	});

	test('the caller headers reach graxia, the transport headers do not', async () => {
		let seen: Headers | undefined;
		const { mcp } = mcpFor(
			{},
			{
				context: ({ request }: { request: Request }) => {
					seen = request.headers;
					return {};
				},
			},
		);
		await call(
			mcp,
			'graphql_query',
			{ query: '{ books { id } }' },
			{ authorization: 'Bearer t' },
		);
		expect(seen?.get('authorization')).toBe('Bearer t');
		expect(seen?.get('mcp-protocol-version')).toBeNull();
	});
});

describe('graphql_mutate', () => {
	test('is not listed by default', async () => {
		const { mcp } = mcpFor();
		const list = await (await mcp.fetch(rpc('tools/list'))).text();
		expect(list).toContain('graphql_query');
		expect(list).not.toContain('graphql_mutate');
		const r = await call(mcp, 'graphql_mutate', {
			query: 'mutation { rename(id:"1", title:"x") { id } }',
		});
		expect(JSON.stringify(r.body)).toContain('graphql_mutate');
		expect(r.result?.isError ?? r.body.error).toBeTruthy();
	});

	test('with mutations: true it runs a mutation and refuses a query', async () => {
		const { mcp } = mcpFor({ mutations: true });
		const ok = await call(mcp, 'graphql_mutate', {
			query: 'mutation { rename(id: "1", title: "Emma") { title } }',
		});
		expect(ok.result.structuredContent).toEqual({
			data: { rename: { title: 'Emma' } },
		});
		const refused = await call(mcp, 'graphql_mutate', {
			query: '{ books { id } }',
		});
		expect(refused.result.structuredContent.errors[0].extensions.fix).toContain(
			'graphql_query',
		);
	});
});
