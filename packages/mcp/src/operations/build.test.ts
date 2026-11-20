import { describe, expect, test } from 'bun:test';
import { GraxiaConfigError } from '@graxia/core';
import { buildOperationTools } from './build';
import { manifestEntries } from './documents';
import { toolNameOf } from './naming';
import { schema } from './schemas.test-util';
import type { McpOperationsOptions } from './types';

const build = (
	documents: Record<string, unknown>,
	extra: Partial<McpOperationsOptions> = {},
	mutations = false,
) =>
	buildOperationTools(
		schema,
		{ documents: documents as Record<string, string>, ...extra },
		mutations,
	);
const failure = (run: () => unknown): string => {
	try {
		run();
	} catch (error) {
		expect(error).toBeInstanceOf(GraxiaConfigError);
		return (error as Error).message;
	}
	throw new Error('did not throw');
};
const ok = '"""Find.""" query BookById($id: ID!) { book(id: $id) { id } }';

describe('names', () => {
	test('snake_case of the operation name', () => {
		expect(toolNameOf('BookById')).toBe('book_by_id');
		expect(toolNameOf('getHTTPStatus')).toBe('get_http_status');
		expect(toolNameOf('books')).toBe('books');
		expect(toolNameOf('Book2List')).toBe('book2_list');
		expect(toolNameOf('already_snake')).toBe('already_snake');
	});
});

describe('what becomes a tool', () => {
	test('one tool per named query, with its document and schemas', () => {
		const [tool, ...rest] = build({ x: ok });
		expect(rest).toEqual([]);
		expect(tool).toMatchObject({
			name: 'book_by_id',
			title: 'BookById',
			description: 'Find.',
			kind: 'query',
			id: 'x',
			source: ok,
		});
		expect((tool as any).inputSchema.required).toEqual(['id']);
		expect((tool as any).outputSchema.properties.data).toBeDefined();
	});
	test('descriptions wins over the description of the operation', () => {
		const [tool] = build({ x: ok }, { descriptions: { BookById: ' Mine. ' } });
		expect(tool?.description).toBe('Mine.');
	});
	test('several operations in one document: one tool each', () => {
		const tools = build({
			x: `${ok} """All.""" query Books { books { id } }`,
		});
		expect(tools.map((t) => t.name)).toEqual(['book_by_id', 'books']);
	});
	test('subscriptions are skipped, mutations need mutations: true', () => {
		const documents = {
			q: ok,
			m: '"""Rename.""" mutation Rename { rename(id: "1", title: "x") { id } }',
			s: 'subscription { nothing }',
		};
		expect(build(documents).map((t) => t.name)).toEqual(['book_by_id']);
		const tools = build(documents, {}, true);
		expect(tools.map((t) => [t.name, t.kind])).toEqual([
			['book_by_id', 'query'],
			['rename', 'mutation'],
		]);
	});
	test('include decides, and what it leaves out is not checked', () => {
		const seen: unknown[] = [];
		const tools = build(
			{ q: ok, bad: 'query Broken { nope }' },
			{
				include: (operation) => {
					seen.push(operation);
					return operation.name !== 'Broken';
				},
			},
		);
		expect(tools).toHaveLength(1);
		expect(seen).toEqual([
			{ name: 'BookById', kind: 'query', id: 'q' },
			{ name: 'Broken', kind: 'query', id: 'bad' },
		]);
	});
	test('the three manifest formats give the same entries', () => {
		const entries = [{ id: 'x', source: ok }];
		expect(manifestEntries({ x: ok })).toEqual(entries);
		expect(manifestEntries(new Map([['x', ok]]))).toEqual(entries);
		expect(
			manifestEntries({
				format: 'apollo-persisted-query-manifest',
				version: 1,
				operations: [{ id: 'x', body: ok, name: 'BookById', type: 'query' }],
			}),
		).toEqual(entries);
	});
});

describe('boot errors, each with its fix', () => {
	test('not a manifest', () => {
		const message = failure(() =>
			buildOperationTools(schema, { documents: 'x' as never }, false),
		);
		expect(message).toContain('operations.documents is not a manifest. Fix:');
	});
	test('a source that is not a string, a document that does not parse', () => {
		const message = failure(() => build({ a: 1, b: 'query {' }));
		expect(message).toContain('createMcp: operations has 2 problems:');
		expect(message).toContain('document "a" is not a GraphQL source string');
		expect(message).toContain('document "b" does not parse: Syntax Error');
	});
	test('an anonymous operation', () => {
		const message = failure(() => build({ a: '{ books { id } }' }));
		expect(message).toContain('createMcp: operations has 1 problem:');
		expect(message).toContain(
			'document "a" holds an anonymous operation: a tool needs a name. Fix: name it (query BookById { ... })',
		);
	});
	test('a document that is not valid against the schema', () => {
		const message = failure(() => build({ a: '"""x""" query Nope { nope }' }));
		expect(message).toContain(
			'Nope (document "a") is not valid against the schema: Cannot query field "nope" on type "Query".',
		);
		expect(message).toContain('operations.include');
	});
	test('@defer', () => {
		const message = failure(() =>
			build({
				a: '"""x""" query Slow { books { id ... @defer { title } } }',
			}),
		);
		expect(message).toContain('Slow (document "a") uses @defer');
	});
	test('a missing description says where to write it', () => {
		const message = failure(() => build({ a: 'query Books { books { id } }' }));
		expect(message).toContain(
			'Books (document "a") has no description: an agent picks a tool by its description. Fix: write one above the operation ("""Find a book by its id.""" query Books ...), or set operations.descriptions.Books.',
		);
	});
	test('two operations with the same tool name', () => {
		const message = failure(() =>
			build({
				a: ok,
				b: '"""x""" query book_by_id { books { id } }',
			}),
		);
		expect(message).toContain(
			'BookById (document "a") and book_by_id (document "b") both give the tool name book_by_id. Fix: rename one of them',
		);
	});
	test('a name the generic tools own', () => {
		const message = failure(() =>
			build({ a: '"""x""" query GraphqlQuery { books { id } }' }),
		);
		expect(message).toContain(
			'GraphqlQuery (document "a") gives the tool name graphql_query, and graphql_* names are the generic tools\'. Fix: rename the operation',
		);
	});
	test('every problem is listed in one error', () => {
		const message = failure(() =>
			build({
				a: '{ books { id } }',
				b: 'query Books { books { id } }',
				c: '"""x""" query Nope { nope }',
				d: 'query {',
			}),
		);
		expect(message).toContain('createMcp: operations has 4 problems:');
		expect(message.split('\n- ')).toHaveLength(5);
	});
});
