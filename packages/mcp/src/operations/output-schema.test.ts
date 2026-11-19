import { describe, expect, test } from 'bun:test';
import { outputSchemaOf } from './output-schema';
import { operationOf, schema } from './schemas.test-util';

const output = (source: string) => {
	const { document, operation } = operationOf(source);
	return outputSchemaOf(schema, document, operation) as any;
};
const data = (source: string) => output(source).properties.data;

describe('the result envelope', () => {
	const s = output('query Q { books { id } }');
	test('an object of data and errors; data may be null', () => {
		expect(s.type).toBe('object');
		expect(Object.keys(s.properties)).toEqual(['data', 'errors']);
		expect(s.properties.data.type).toEqual(['object', 'null']);
	});
	test('errors carry message, path and extensions.code and fix', () => {
		const error = s.properties.errors.items;
		expect(error.required).toEqual(['message']);
		expect(Object.keys(error.properties.extensions.properties)).toEqual([
			'code',
			'fix',
		]);
	});
});

describe('fields', () => {
	const book = data(
		'query Q { book(id: "1") { id title note pages rating sort published tags related { id } } }',
	).properties.book;
	test('a nullable object and its required keys', () => {
		expect(book.type).toEqual(['object', 'null']);
		expect(book.required).toContain('id');
		expect(book.required).toContain('note');
	});
	test('nullability of scalars', () => {
		expect(book.properties.id).toEqual({ type: 'string' });
		expect(book.properties.title).toEqual({ type: 'string' });
		expect(book.properties.note).toEqual({ type: ['string', 'null'] });
		expect(book.properties.pages).toEqual({ type: ['integer', 'null'] });
		expect(book.properties.rating).toEqual({ type: ['number', 'null'] });
	});
	test('an enum and a custom scalar', () => {
		expect(book.properties.sort.enum).toEqual(['NEW', 'OLD', null]);
		expect(book.properties.published).toEqual({});
	});
	test('lists', () => {
		expect(book.properties.tags).toEqual({
			type: 'array',
			items: { type: 'string' },
		});
		expect(book.properties.related.type).toEqual(['array', 'null']);
		expect(book.properties.related.items.type).toEqual(['object', 'null']);
		expect(data('query Q { books { id } }').properties.books.items.type).toBe(
			'object',
		);
	});
	test('an alias is the property name', () => {
		const s = data('query Q { first: book(id: "1") { name: title } }');
		expect(s.properties.first.properties.name).toEqual({ type: 'string' });
	});
	test('@skip and @include make a field optional', () => {
		const s = data(
			'query Q($a: Boolean!) { book(id: "1") { id title @include(if: $a) } }',
		);
		expect(s.properties.book.required).toEqual(['id']);
	});
});

describe('fragments and abstract types', () => {
	test('a fragment and an inline fragment on the same type are merged', () => {
		const s = data(
			'query Q { book(id: "1") { id ...F ... on Book { note } ... { pages } } } fragment F on Book { title related { id } related { title } }',
		).properties.book;
		expect(s.required).toEqual(['id', 'title', 'related', 'note', 'pages']);
		expect(Object.keys(s.properties.related.items.properties)).toEqual([
			'id',
			'title',
		]);
	});
	test('__typename is a string', () => {
		const s = data('query Q { node(id: "1") { __typename id } }');
		expect(s.properties.node.properties.__typename).toEqual({
			type: 'string',
		});
		expect(s.properties.node.required).toEqual(['__typename', 'id']);
	});
	test('on an interface, the fields of a narrower fragment are optional', () => {
		const s = data(
			'query Q { node(id: "1") { id ... on Book { title } ... on Author { name } } }',
		).properties.node;
		expect(Object.keys(s.properties)).toEqual(['id', 'title', 'name']);
		expect(s.required).toEqual(['id']);
	});
	test('on a union: a fragment on an interface every member implements is required', () => {
		const s = data(
			'query Q { search(text: "x") { __typename ... on Node { id } ... on Book { title } } }',
		).properties.search.items;
		expect(s.required).toEqual(['__typename', 'id']);
		expect(s.properties.title).toEqual({ type: 'string' });
	});
	test('one key with two types across fragments is an anyOf', () => {
		const s = data(
			'query Q { search(text: "x") { ... on Book { x: pages } ... on Author { x: name } } }',
		).properties.search.items;
		expect(s.properties.x).toEqual({
			anyOf: [{ type: ['integer', 'null'] }, { type: 'string' }],
		});
		expect(s.required).toBeUndefined();
	});
	test('a mutation reads the Mutation root', () => {
		const s = data('mutation M { rename(id: "1", title: "x") { title } }');
		expect(s.properties.rename.properties.title).toEqual({ type: 'string' });
	});
});
