import { describe, expect, test } from 'bun:test';
import {
	buildSchema,
	GraphQLInputObjectType,
	GraphQLInt,
	GraphQLNonNull,
	GraphQLObjectType,
	GraphQLSchema,
	GraphQLString,
} from 'graphql';
import { inputSchemaOf } from './input-schema';
import { operationOf, schema } from './schemas.test-util';

const input = (source: string, against = schema) => {
	const { document, operation } = operationOf(source);
	return inputSchemaOf(against, document, operation) as any;
};

describe('input objects', () => {
	test('a code-first defaultValue lifts required and is the default', () => {
		const Page = new GraphQLInputObjectType({
			name: 'Page',
			fields: {
				limit: { type: new GraphQLNonNull(GraphQLInt), defaultValue: 10 },
				after: { type: new GraphQLNonNull(GraphQLString) },
			},
		});
		const codeFirst = new GraphQLSchema({
			query: new GraphQLObjectType({
				name: 'Query',
				fields: {
					list: { type: GraphQLString, args: { page: { type: Page } } },
				},
			}),
		});
		const page = input('query Q($page: Page) { list(page: $page) }', codeFirst)
			.$defs.Page;
		expect(page.required).toEqual(['after']);
		expect(page.properties.limit.default).toBe(10);
	});
	test('an input type named like an Object.prototype member is defined', () => {
		const odd = buildSchema(
			'input constructor { a: Int } input toString { b: constructor } type Query { f(x: toString): Int }',
		);
		const s = input('query Q($x: toString) { f(x: $x) }', odd);
		expect(Object.keys(s.$defs).sort()).toEqual(['constructor', 'toString']);
		expect(s.$defs.constructor.properties.a.type).toEqual(['integer', 'null']);
		expect(s.$defs.toString.properties.b.anyOf[0]).toEqual({
			$ref: '#/$defs/constructor',
		});
	});
});

describe('variable usages', () => {
	const document = `
		query A($t: String) { byTitle(title: $t) { id } }
		query B($t: String) { ...F }
		fragment F on Query { byPrefix(title: $t) { id } }
	`;
	test('a fragment the operation does not reach does not count', () => {
		expect(input(document).properties.t).toMatchObject({
			maxLength: 20,
			pattern: '^a',
		});
	});
	test('a fragment reached through another fragment counts', () => {
		const s = input(`
			query A($t: String) { ...Outer }
			fragment Outer on Query { ...Inner }
			fragment Inner on Query { byPrefix(title: $t) { id } }
			fragment Unused on Query { byTitle(title: $t) { id } }
		`);
		expect(s.properties.t).toMatchObject({ maxLength: 10, pattern: '^b' });
	});
});
