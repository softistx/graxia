import { describe, expect, test } from 'bun:test';
import { tightest } from './constraint';
import { inputSchemaOf } from './input-schema';
import { operationOf, schema } from './schemas.test-util';

const input = (source: string) => {
	const { document, operation } = operationOf(source);
	return inputSchemaOf(schema, document, operation) as any;
};

describe('scalars, lists and required', () => {
	const s = input(
		'query Q($id: ID!, $first: Int, $flag: Boolean, $ratio: Float, $text: String!, $on: Date) { books(first: $first, flag: $flag, ratio: $ratio, on: $on) { id } book(id: $id) { id } search(text: $text) { __typename } }',
	);
	test('an object that takes no other property', () => {
		expect(s.type).toBe('object');
		expect(s.additionalProperties).toBe(false);
		expect(s.$defs).toBeUndefined();
	});
	test('each built-in scalar; a nullable one also accepts null', () => {
		expect(s.properties.id.type).toBe('string');
		expect(s.properties.text).toEqual({ type: 'string' });
		expect(s.properties.first).toEqual({ type: ['integer', 'null'] });
		expect(s.properties.flag).toEqual({ type: ['boolean', 'null'] });
		expect(s.properties.ratio).toEqual({ type: ['number', 'null'] });
	});
	test('a custom scalar accepts anything and keeps its description', () => {
		expect(s.properties.on).toEqual({ description: 'An ISO date.' });
	});
	test('non-null without a default is required', () => {
		expect(s.required).toEqual(['id', 'text']);
	});
	test('no variable: no property and nothing required', () => {
		expect(input('query Q { books { id } }')).toEqual({
			type: 'object',
			properties: {},
			additionalProperties: false,
		});
	});
	test('a list, with its items', () => {
		const l = input('query Q($ids: [ID!]!, $maybe: [String]) { books { id } }');
		expect(l.properties.ids).toEqual({
			type: 'array',
			items: { type: 'string' },
		});
		expect(l.properties.maybe).toEqual({
			type: ['array', 'null'],
			items: { type: ['string', 'null'] },
		});
	});
});

describe('defaults and descriptions', () => {
	test('a variable default goes to default and lifts required', () => {
		const s = input(
			'query Q($first: Int! = 3, $sort: Sort = OLD) { books(first: $first) { id } }',
		);
		expect(s.properties.first).toEqual({ type: 'integer', default: 3 });
		expect(s.properties.sort.default).toBe('OLD');
		expect(s.required).toBeUndefined();
	});
	test("the variable's own description wins over the argument's", () => {
		const own = input(
			'query Q("""Which book.""" $id: ID!) { book(id: $id) { id } }',
		);
		expect(own.properties.id.description).toBe('Which book.');
		const fed = input('query Q($id: ID!) { book(id: $id) { id } }');
		expect(fed.properties.id.description).toBe('The id of the book.');
	});
	test('an enum lists its values and describes the ones that say something', () => {
		const s = input('query Q($sort: Sort!) { books { id } }');
		expect(s.properties.sort).toEqual({
			type: 'string',
			enum: ['NEW', 'OLD'],
			description: 'How to sort.\n- NEW: Newest first.',
		});
		const n = input('query Q($sort: Sort) { books { id } }');
		expect(n.properties.sort.enum).toEqual(['NEW', 'OLD', null]);
		expect(n.properties.sort.type).toEqual(['string', 'null']);
	});
});

describe('input objects', () => {
	const s = input('query Q($f: Filter) { books(filter: $f) { id } }');
	const filter = s.$defs.Filter;
	test('a nullable input object is a $ref or null', () => {
		expect(s.properties.f).toEqual({
			anyOf: [{ $ref: '#/$defs/Filter' }, { type: 'null' }],
		});
	});
	test('nested fields: description, default, required, deprecated', () => {
		expect(filter.type).toBe('object');
		expect(filter.description).toBe('A filter.');
		expect(filter.additionalProperties).toBe(false);
		expect(filter.properties.sort.default).toBe('NEW');
		expect(filter.properties.limit).toEqual({ type: 'integer', default: 10 });
		expect(filter.required).toBeUndefined();
		expect(filter.properties.old.deprecated).toBe(true);
		expect(filter.properties.after).toEqual({ description: 'An ISO date.' });
	});
	test('a recursive input ends on its own $ref', () => {
		expect(filter.properties.and).toEqual({
			type: ['array', 'null'],
			items: { $ref: '#/$defs/Filter' },
		});
	});
	test('@constraint on an input field', () => {
		expect(filter.properties.text).toEqual({
			type: ['string', 'null'],
			minLength: 2,
			maxLength: 50,
			description: 'Words to find.',
		});
		expect(filter.properties.tags).toEqual({
			type: ['array', 'null'],
			maxItems: 3,
			items: { type: 'string', pattern: '^[a-z]+$' },
		});
	});
	test('@oneOf is a oneOf of single-key objects', () => {
		expect(s.$defs.Pick).toEqual({
			type: 'object',
			oneOf: [
				{
					properties: { id: { type: 'string', description: 'By id.' } },
					required: ['id'],
					additionalProperties: false,
				},
				{
					properties: { slug: { type: 'string', format: 'slug' } },
					required: ['slug'],
					additionalProperties: false,
				},
			],
		});
		const direct = input('query Q($p: Pick!) { pick(pick: $p) { id } }');
		expect(direct.properties.p).toEqual({ $ref: '#/$defs/Pick' });
		expect(direct.required).toEqual(['p']);
	});
});

describe('@constraint through the argument a variable feeds', () => {
	test('one usage: its limits', () => {
		const s = input('query Q($id: ID!) { book(id: $id) { id } }');
		expect(s.properties.id).toEqual({
			type: 'string',
			minLength: 1,
			maxLength: 36,
			description: 'The id of the book.',
		});
	});
	test('a variable used as an input field value takes the field limits', () => {
		const s = input(
			'query Q($text: String) { books(filter: { text: $text }) { id } }',
		);
		expect(s.properties.text).toEqual({
			type: ['string', 'null'],
			minLength: 2,
			maxLength: 50,
			description: 'Words to find.',
		});
	});
	test('several usages: the tightest bound, a differing pattern is dropped', () => {
		const s = input(
			'query Q($t: String) { a: byTitle(title: $t) { id } b: byPrefix(title: $t) { id } }',
		);
		expect(s.properties.t).toEqual({ type: ['string', 'null'], maxLength: 10 });
	});
	test('a usage in a fragment counts', () => {
		const s = input(
			'query Q($t: String) { ...F } fragment F on Query { byTitle(title: $t) { id } }',
		);
		expect(s.properties.t.pattern).toBe('^a');
	});
	test('tightest: bounds narrow, an agreed pattern stays', () => {
		expect(
			tightest([
				{ min: 1, max: 10, pattern: 'a', minItems: 1 },
				{ min: 3, max: 20, pattern: 'a', format: 'x' },
			]),
		).toEqual({ min: 3, max: 10, pattern: 'a', minItems: 1, format: 'x' });
		expect(tightest([])).toBeUndefined();
		expect(tightest([{ format: 'a' }, { format: 'b' }])).toBeUndefined();
	});
});
