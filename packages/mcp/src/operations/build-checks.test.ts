import { describe, expect, test } from 'bun:test';
import { GraxiaConfigError } from '@graxia/core';
import { buildOperationTools } from './build';
import { schema } from './schemas.test-util';
import type { McpOperationsOptions } from './types';

const build = (
	documents: Record<string, string>,
	extra: Partial<McpOperationsOptions> = {},
) => buildOperationTools(schema, { documents, ...extra }, false);
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

describe('descriptions', () => {
	test('an operation named like an Object.prototype member keeps its own description', () => {
		const tools = build(
			{
				a: '"""Own.""" query constructor { books { id } }',
				b: '"""Mine.""" query toString { books { id } }',
			},
			{ descriptions: {} },
		);
		expect(tools.map((t) => [t.name, t.description])).toEqual([
			['constructor', 'Own.'],
			['to_string', 'Mine.'],
		]);
	});
	test('a key that matches no operation is a problem', () => {
		const message = failure(() =>
			build({ a: ok }, { descriptions: { Books: 'All.' } }),
		);
		expect(message).toContain(
			'operations.descriptions.Books matches no operation of operations.documents. Fix: remove the key',
		);
	});
	test('a key that differs only by case names the operation', () => {
		const message = failure(() =>
			build({ a: ok }, { descriptions: { bookById: 'Find it.' } }),
		);
		expect(message).toContain('(there is BookById: names are case-sensitive)');
		expect(message).toContain('Fix: rename the key to BookById.');
	});
	test('a key for an operation that is not a tool here is fine', () => {
		const tools = build(
			{
				a: ok,
				m: 'mutation Rename($id: ID!) { rename(id: $id, title: "x") { id } }',
				o: 'query Other { books { id } }',
			},
			{
				descriptions: { Rename: 'Rename.', Other: 'Other.' },
				include: (operation) => operation.name !== 'Other',
			},
		);
		expect(tools.map((t) => t.name)).toEqual(['book_by_id']);
	});
});

describe('boot problems', () => {
	test('introspection has its own fix', () => {
		const message = failure(() =>
			build({ a: '"""x""" query Types { __schema { types { name } } }' }),
		);
		expect(message).toContain(
			'Types (document "a") selects __schema or __type: introspection is not offered over MCP',
		);
		expect(message).toContain(
			'Fix: leave the operation out with operations.include.',
		);
		expect(message).not.toContain('regenerate');
	});
	test('a tool name longer than 128 characters', () => {
		const name = `Q${'a'.repeat(128)}`;
		const message = failure(() =>
			build({ a: `"""x""" query ${name} { books { id } }` }),
		);
		expect(message).toContain(
			'gives a tool name of 129 characters, and MCP allows 128. Fix: rename the operation',
		);
		const fits = `Q${'a'.repeat(127)}`;
		expect(
			build({ a: `"""x""" query ${fits} { books { id } }` })[0]?.name,
		).toHaveLength(128);
	});
});
