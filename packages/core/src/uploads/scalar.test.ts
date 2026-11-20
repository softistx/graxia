import { describe, expect, test } from 'bun:test';
import {
	GraphQLError,
	GraphQLInt,
	GraphQLObjectType,
	GraphQLSchema,
	graphql,
} from 'graphql';
import { GraphQLFile } from './scalar';

const schema = new GraphQLSchema({
	query: new GraphQLObjectType({
		name: 'Query',
		fields: {
			size: {
				type: GraphQLInt,
				args: { file: { type: GraphQLFile } },
				resolve: (_: unknown, { file }: { file: File | null }) =>
					file?.size ?? -1,
			},
			out: { type: GraphQLFile, resolve: () => new File(['x'], 'a.txt') },
		},
	}),
});
const run = (source: string, variableValues?: Record<string, unknown>) =>
	graphql({ schema, source, ...(variableValues ? { variableValues } : {}) });

describe('GraphQLFile', () => {
	test('accepts a File', async () => {
		const file = new File(['abc'], 'a.txt');
		const result = await run('query($f: File){ size(file: $f) }', { f: file });
		expect(result.data).toEqual({ size: 3 });
	});
	test.each([
		['a string', 'abc'],
		['an object', { name: 'a.txt', size: 3 }],
		['an array', []],
		['a number', 1],
	])('refuses %s in variables', async (_, value) => {
		const result = await run('query($f: File){ size(file: $f) }', { f: value });
		expect(result.errors?.[0]).toBeInstanceOf(GraphQLError);
		expect(result.errors?.[0]?.message).toContain(
			'File must be sent as a file part of a multipart request',
		);
	});
	test('refuses a Blob that is not a File', async () => {
		const result = await run('query($f: File){ size(file: $f) }', {
			f: new Blob(['x']),
		});
		expect(result.errors).toHaveLength(1);
	});
	test('refuses an inline literal', async () => {
		const result = await run('{ size(file: "abc") }');
		expect(result.errors?.[0]?.message).toContain(
			'File must be sent as a file part',
		);
	});
	test('cannot be an output', async () => {
		const result = await run('{ out }');
		expect(result.errors?.[0]?.message).toContain(
			'File must be sent as a file part',
		);
	});
});
