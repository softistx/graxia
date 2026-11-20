import { describe, expect, test } from 'bun:test';
import { GraxiaConfigError } from '@softistx/graxia';
import { call, mcpFor, rpc } from './fixtures.test-util';
import { listed, manifest } from './operations.test-util';

const operations = { documents: manifest };
const names = async (mcp: { fetch(r: Request): Promise<Response> }) =>
	(await listed(mcp, rpc('tools/list'))).map((t) => t.name);
const strict = { trustedDocuments: { manifest, mode: 'strict' } };

describe('arguments', () => {
	const { mcp } = mcpFor({ operations });
	test('an argument the input schema does not have is refused', async () => {
		const r = await call(mcp, 'book_by_id', { id: '1', extra: 1 });
		expect(r.result.isError).toBe(true);
		expect(r.result.structuredContent.errors).toEqual([
			{
				message: 'book_by_id does not take the argument extra.',
				extensions: {
					code: 'MCP_UNKNOWN_ARGUMENT',
					fix: 'Send only the arguments the tool accepts: id.',
				},
			},
		]);
		const none = await call(mcp, 'books', { a: 1, b: 2 });
		expect(none.result.structuredContent.errors[0]).toEqual({
			message: 'books does not take the arguments a, b.',
			extensions: {
				code: 'MCP_UNKNOWN_ARGUMENT',
				fix: 'Send no argument: the tool takes none.',
			},
		});
	});
	test('a bad variable keeps its message and code, with a fix about the arguments', async () => {
		const r = await call(mcp, 'book_by_id', {});
		expect(r.result.isError).toBe(true);
		const [error] = r.result.structuredContent.errors;
		expect(error.message).toContain('$id');
		expect(error.extensions).toEqual({
			code: 'BAD_USER_INPUT',
			fix: "Correct the arguments: see the tool's input schema.",
		});
		const wrong = await call(mcp, 'book_by_id', { id: { a: 1 } });
		const [second] = wrong.result.structuredContent.errors;
		expect(second.message).toContain('ID cannot represent value');
		expect(second.extensions.code).toBe('BAD_USER_INPUT');
		expect(JSON.parse(wrong.result.content[0].text)).toEqual(
			wrong.result.structuredContent,
		);
	});
});

describe('strict trusted documents', () => {
	test('the generic tools are not listed; the typed tools are, and run', async () => {
		const { mcp } = mcpFor({ operations, mutations: true }, strict);
		expect(await names(mcp)).toEqual([
			'graphql_schema',
			'book_by_id',
			'books',
			'rename_book',
			'staff_report',
		]);
		const r = await call(mcp, 'book_by_id', { id: '1' });
		expect(r.result.structuredContent.data.book.title).toBe('Dune');
	});
	test('a call to a generic tool is refused and runs nothing', async () => {
		let ran = 0;
		const { mcp } = mcpFor(
			{ operations, mutations: true },
			{ ...strict, context: () => ({ ran: ran++ }) },
		);
		for (const [tool, query] of [
			['graphql_query', '{ books { id } }'],
			['graphql_mutate', 'mutation { rename(id: "1", title: "x") { id } }'],
		] as const) {
			const r = await call(mcp, tool, { query });
			expect(r.result.isError).toBe(true);
			expect(r.result.structuredContent).toEqual({
				errors: [
					{
						message: 'Only persisted documents are allowed.',
						extensions: {
							code: 'PERSISTED_QUERY_ONLY',
							fix: 'This server runs trusted documents only: use the typed tools (book_by_id, books, rename_book, staff_report).',
						},
					},
				],
			});
		}
		expect(ran).toBe(0);
	});
	test('the mode graxia takes from NODE_ENV counts', async () => {
		const before = process.env['NODE_ENV'];
		process.env['NODE_ENV'] = 'production';
		try {
			const { mcp } = mcpFor(
				{ operations },
				{ trustedDocuments: { manifest } },
			);
			expect(await names(mcp)).not.toContain('graphql_query');
		} finally {
			process.env['NODE_ENV'] = before ?? 'test';
		}
	});
	test('without operations: boots with graphql_schema only, and says so', async () => {
		const { mcp } = mcpFor({}, strict);
		expect(await names(mcp)).toEqual(['graphql_schema']);
		const r = await call(mcp, 'graphql_query', { query: '{ books { id } }' });
		expect(r.result.structuredContent.errors[0].extensions).toEqual({
			code: 'PERSISTED_QUERY_ONLY',
			fix: 'This server runs trusted documents only and offers you no typed tool: no operation can be run here.',
		});
		const overview = await call(mcp, 'graphql_schema', {});
		expect(overview.result.content[0].text).toContain(
			'this server runs trusted documents only',
		);
	});
	test('genericTools: false without operations still throws', () => {
		expect(() => mcpFor({ genericTools: false }, strict)).toThrow(
			GraxiaConfigError,
		);
	});
	test('the overview names the typed tools as the only way', async () => {
		const { mcp } = mcpFor({ operations }, strict);
		const r = await call(mcp, 'graphql_schema', {});
		expect(r.result.content[0].text).toContain(
			'They are the only way to run operations here.',
		);
	});
	test('mixed mode is unchanged', async () => {
		const { mcp } = mcpFor(
			{ operations },
			{ trustedDocuments: { manifest, mode: 'mixed' } },
		);
		expect(await names(mcp)).toContain('graphql_query');
		const r = await call(mcp, 'graphql_query', { query: '{ books { id } }' });
		expect(r.result.structuredContent.data.books).toHaveLength(1);
	});
});

describe('the view, with can', () => {
	test('can runs for tools/list and tools/call, not for initialize, ping or a notification', async () => {
		let asked = 0;
		const { mcp } = mcpFor({
			operations,
			can: () => {
				asked++;
				return () => true;
			},
		});
		await (await mcp.fetch(rpc('initialize', {}))).text();
		await (await mcp.fetch(rpc('ping'))).text();
		await (
			await mcp.fetch(
				new Request('http://localhost/mcp', {
					method: 'POST',
					headers: {
						'content-type': 'application/json',
						accept: 'application/json, text/event-stream',
					},
					body: JSON.stringify({
						jsonrpc: '2.0',
						method: 'notifications/initialized',
					}),
				}),
			)
		).text();
		expect(asked).toBe(0);
		await names(mcp);
		expect(asked).toBe(1);
		await call(mcp, 'book_by_id', { id: '1' });
		expect(asked).toBe(2);
	});
	test('can throws: a typed tool answers the retry-later error, and nothing is listed', async () => {
		const errors: unknown[] = [];
		const { mcp } = mcpFor({
			operations,
			can: () => {
				throw new Error('permissions down');
			},
			onError: (error) => void errors.push(error),
		});
		const typed = await call(mcp, 'book_by_id', { id: '1' });
		const generic = await call(mcp, 'graphql_query', {
			query: '{ books { id } }',
		});
		expect(typed.result).toEqual(generic.result);
		expect(typed.result).toEqual({
			content: [
				{
					type: 'text',
					text: 'The server failed to run the operation. Fix: retry later.',
				},
			],
			isError: true,
		});
		expect(JSON.stringify(typed.body)).not.toContain('permissions down');
		expect(errors.length).toBeGreaterThan(0);
		const unknown = await call(mcp, 'no_such_tool', {});
		expect(unknown.body.error.message).toBe('Tool no_such_tool not found');
		expect(await names(mcp)).toEqual(['graphql_schema', 'graphql_query']);
	});
});
