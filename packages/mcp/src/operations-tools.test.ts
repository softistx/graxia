import { describe, expect, test } from 'bun:test';
import { fromJsonSchema } from '@modelcontextprotocol/server';
import { GraxiaConfigError } from '@softistx/graxia';
import { call, mcpFor, rpc } from './fixtures.test-util';
import { apollo, asMap, listed, manifest } from './operations.test-util';

const operations = { documents: manifest };
const names = async (mcp: { fetch(r: Request): Promise<Response> }) =>
	(await listed(mcp, rpc('tools/list'))).map((t) => t.name);

describe('tools/list', () => {
	test('a manifest and nothing else: the typed tools follow the generic ones', async () => {
		const { mcp } = mcpFor({ operations });
		const tools = await listed(mcp, rpc('tools/list'));
		expect(tools.map((t) => t.name)).toEqual([
			'graphql_schema',
			'graphql_query',
			'book_by_id',
			'books',
			'staff_report',
		]);
		const tool = tools.find((t) => t.name === 'book_by_id');
		expect(tool.title).toBe('BookById');
		expect(tool.description).toBe('Find a book by its id.');
		expect(tool.annotations).toEqual({ readOnlyHint: true });
		expect(tool.inputSchema).toEqual({
			type: 'object',
			properties: { id: { type: 'string', description: 'The book id.' } },
			required: ['id'],
			additionalProperties: false,
		});
		expect(tool.outputSchema.properties.data.properties.book.type).toEqual([
			'object',
			'null',
		]);
	});
	test('mutations: true lists the mutation tool as destructive', async () => {
		const { mcp } = mcpFor({ operations, mutations: true });
		const tools = await listed(mcp, rpc('tools/list'));
		expect(tools.map((t) => t.name)).toContain('rename_book');
		expect(tools.find((t) => t.name === 'rename_book').annotations).toEqual({
			readOnlyHint: false,
			destructiveHint: true,
		});
	});
	test('include filters, subscriptions never show', async () => {
		const { mcp } = mcpFor({
			operations: { ...operations, include: (o) => o.name === 'Books' },
		});
		expect(await names(mcp)).toEqual([
			'graphql_schema',
			'graphql_query',
			'books',
		]);
	});
	test('a tool whose operation the caller may not see is not listed', async () => {
		const { mcp } = mcpFor({ operations, can: () => () => false });
		expect(await names(mcp)).not.toContain('staff_report');
		const staff = mcpFor({ operations, can: () => () => true });
		expect(await names(staff.mcp)).toContain('staff_report');
	});
	test('a can that throws offers no typed tool and reports the cause', async () => {
		const errors: unknown[] = [];
		const cause = new Error('down');
		const { mcp } = mcpFor({
			operations,
			onError: (e) => void errors.push(e),
			can: () => {
				throw cause;
			},
		});
		expect(await names(mcp)).toEqual(['graphql_schema', 'graphql_query']);
		expect(errors).toEqual([cause]);
	});
	test('genericTools: false keeps graphql_schema and the typed tools', async () => {
		const { mcp } = mcpFor({
			operations,
			genericTools: false,
			mutations: true,
		});
		expect(await names(mcp)).toEqual([
			'graphql_schema',
			'book_by_id',
			'books',
			'rename_book',
			'staff_report',
		]);
		const r = await call(mcp, 'graphql_query', { query: '{ books { id } }' });
		expect(r.body.error.message).toBe('Tool graphql_query not found');
	});
	test('genericTools: false needs operations that give a tool', () => {
		expect(() => mcpFor({ genericTools: false })).toThrow(GraxiaConfigError);
		expect(() => mcpFor({ genericTools: false })).toThrow(
			'genericTools is false and there is no operations',
		);
		expect(() =>
			mcpFor({
				genericTools: false,
				operations: { ...operations, include: () => false },
			}),
		).toThrow('genericTools is false and operations gives no tool');
	});
	test('a boot problem is thrown by createMcp', () => {
		expect(() =>
			mcpFor({
				operations: { documents: { a: 'query Books { books { id } }' } },
			}),
		).toThrow('Books (document "a") has no description');
	});
	test('the schema overview points at the typed tools the caller has', async () => {
		const { mcp } = mcpFor({ operations, can: () => () => false });
		const r = await call(mcp, 'graphql_schema', {});
		expect(r.result.content[0].text).toContain(
			'Typed tools: book_by_id, books. Prefer the typed tools',
		);
		const only = mcpFor({ operations, genericTools: false });
		const o = await call(only.mcp, 'graphql_schema', {});
		expect(o.result.content[0].text).toContain(
			'the only way to run operations',
		);
		const none = await call(mcpFor().mcp, 'graphql_schema', {});
		expect(none.result.content[0].text).not.toContain('Typed tools');
	});
});

describe('tools/call', () => {
	test('runs the operation with the arguments as variables', async () => {
		const { mcp } = mcpFor({ operations });
		const r = await call(mcp, 'book_by_id', { id: '1' });
		expect(r.result.structuredContent).toEqual({
			data: { book: { id: '1', title: 'Dune' } },
		});
		expect(JSON.parse(r.result.content[0].text)).toEqual(
			r.result.structuredContent,
		);
		expect(r.result.isError).toBeUndefined();
	});
	test('the result validates against the advertised output schema', async () => {
		const { mcp } = mcpFor({ operations });
		const tools = await listed(mcp, rpc('tools/list'));
		for (const [name, args] of [
			['book_by_id', { id: '1' }],
			['book_by_id', { id: 'none' }],
			['books', {}],
		] as const) {
			const schema = tools.find((t) => t.name === name).outputSchema;
			const r = await call(mcp, name, args);
			const checked = await fromJsonSchema(schema)['~standard'].validate(
				r.result.structuredContent,
			);
			expect(checked.issues).toBeUndefined();
		}
		const wrong = await fromJsonSchema(
			tools.find((t) => t.name === 'books').outputSchema,
		)['~standard'].validate({ data: { books: [{ id: 1 }] } });
		expect(wrong.issues).toBeDefined();
	});
	test('a mutation tool runs with mutations: true and does not exist without', async () => {
		const { mcp } = mcpFor({ operations, mutations: true });
		const r = await call(mcp, 'rename_book', { id: '1', title: 'Messiah' });
		expect(r.result.structuredContent.data.rename.title).toBe('Messiah');
		const off = await call(mcpFor({ operations }).mcp, 'rename_book', {
			id: '1',
			title: 'x',
		});
		expect(off.body.error.message).toBe('Tool rename_book not found');
	});
	test('a hidden tool answers like an unknown one', async () => {
		const { mcp } = mcpFor({ operations, can: () => () => false });
		const hidden = await call(mcp, 'staff_report', {});
		const unknown = await call(mcp, 'no_such_tool', {});
		expect(hidden.body.error).toEqual({
			code: -32602,
			message: 'Tool staff_report not found',
		});
		expect(unknown.body.error.code).toBe(hidden.body.error.code);
		const staff = mcpFor({ operations, can: () => () => true });
		const r = await call(staff.mcp, 'staff_report', {});
		expect(r.result.structuredContent).toEqual({
			data: { staffReport: 'report' },
		});
	});
	test('strict trusted documents: the typed tools run', async () => {
		const { mcp } = mcpFor(
			{ operations },
			{ trustedDocuments: { manifest, mode: 'strict' } },
		);
		const r = await call(mcp, 'book_by_id', { id: '1' });
		expect(r.result.structuredContent.data.book.title).toBe('Dune');
	});
	test('strict, with a document graxia does not hold: it still runs in process', async () => {
		const { mcp } = mcpFor(
			{ operations },
			{
				trustedDocuments: {
					manifest: { z: '{ books { id } }' },
					mode: 'strict',
				},
			},
		);
		const r = await call(mcp, 'books', {});
		expect(r.result.structuredContent.data.books).toHaveLength(1);
	});
	test('the Apollo manifest and a Map give the same tools', async () => {
		for (const documents of [apollo, asMap]) {
			const { mcp } = mcpFor({ operations: { documents } });
			expect(await names(mcp)).toContain('book_by_id');
			const r = await call(mcp, 'books', {});
			expect(r.result.structuredContent.data.books[0].title).toBe('Dune');
		}
	});
	test("graxia's masking applies", async () => {
		const { mcp } = mcpFor({
			operations: {
				documents: { b: '"""Fails.""" query Boom { boom }' },
			},
			onError: false,
		});
		const r = await call(mcp, 'boom', {});
		expect(JSON.stringify(r.result)).not.toContain('db password');
		expect(r.result.structuredContent.errors[0].extensions.code).toBeDefined();
	});
});
