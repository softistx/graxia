import { describe, expect, test } from 'bun:test';
import { parseMap, placeFiles } from './map';

const file = (name = 'a.txt') => new File(['x'], name);
const place = (
	operations: unknown,
	map: Record<string, string[]>,
	files: Record<string, File>,
) => {
	const parsed = parseMap(map);
	if (!parsed.ok) throw new Error(parsed.message);
	return placeFiles(operations, parsed.map, new Map(Object.entries(files)));
};
const op = (variables: unknown) => ({ query: 'q', variables });

describe('placeFiles', () => {
	test('places one file', () => {
		const a = file();
		const operations = op({ f: null });
		expect(place(operations, { 0: ['variables.f'] }, { 0: a })).toEqual({
			ok: true,
		});
		expect(operations.variables).toEqual({ f: a });
	});
	test('places several files, one file at two paths, and array indexes', () => {
		const [a, b] = [file('a'), file('b')];
		const operations = op({
			one: null,
			two: null,
			list: [null, null],
			deep: { x: null },
		});
		const result = place(
			operations,
			{
				0: ['variables.one', 'variables.list.0'],
				1: ['variables.list.1', 'variables.deep.x'],
			},
			{ 0: a, 1: b },
		);
		expect(result).toEqual({ ok: true });
		expect(operations.variables).toMatchObject({
			one: a,
			list: [a, b],
			deep: { x: b },
		});
	});
	test('places into a batch by entry index', () => {
		const a = file();
		const operations = [op({ f: null }), op({ f: null })];
		expect(place(operations, { 0: ['1.variables.f'] }, { 0: a })).toEqual({
			ok: true,
		});
		expect(operations[1]?.variables).toEqual({ f: a });
		expect(operations[0]?.variables).toEqual({ f: null });
	});

	const refused = (
		operations: unknown,
		map: Record<string, string[]>,
		files: Record<string, File>,
		message: string,
	) => expect(place(operations, map, files)).toEqual({ ok: false, message });

	test.each([
		['query'],
		['operationName'],
		['extensions.x'],
		['variables'],
		['Variables.f'],
	])('refuses a path outside variables: %s', (path) => {
		refused(
			{
				query: 'q',
				operationName: 'x',
				extensions: { x: null },
				variables: { f: null },
			},
			{ 0: [path] },
			{ 0: file() },
			`Map entry "0" points at "${path}"; a file may only go under "variables".`,
		);
	});
	test('refuses a batch path without an entry index, or out of range', () => {
		const operations = [op({ f: null })];
		refused(
			operations,
			{ 0: ['variables.f'] },
			{ 0: file() },
			'Map entry "0" points at "variables.f"; a file may only go under "variables".',
		);
		refused(
			operations,
			{ 0: ['5.variables.f'] },
			{ 0: file() },
			'Map entry "0" points at "5.variables.f"; a file may only go under "variables".',
		);
	});
	test('refuses a missing key and a slot that is not null', () => {
		const message = (p: string) =>
			`Map entry "0" points at "${p}", which is not null in "operations".`;
		refused(
			op({}),
			{ 0: ['variables.f'] },
			{ 0: file() },
			message('variables.f'),
		);
		refused(
			op({ f: 'x' }),
			{ 0: ['variables.f'] },
			{ 0: file() },
			message('variables.f'),
		);
		refused(
			op({ f: { g: null } }),
			{ 0: ['variables.f'] },
			{ 0: file() },
			message('variables.f'),
		);
		refused(
			op({ f: 'x' }),
			{ 0: ['variables.f.g'] },
			{ 0: file() },
			message('variables.f.g'),
		);
		refused(
			op({ l: [null] }),
			{ 0: ['variables.l.1'] },
			{ 0: file() },
			message('variables.l.1'),
		);
		refused(
			op({ l: [null] }),
			{ 0: ['variables.l.length'] },
			{ 0: file() },
			message('variables.l.length'),
		);
		refused(
			op(null),
			{ 0: ['variables.f'] },
			{ 0: file() },
			message('variables.f'),
		);
	});
	test('the same slot twice is refused (it is no longer null)', () => {
		refused(
			op({ f: null }),
			{ 0: ['variables.f'], 1: ['variables.f'] },
			{ 0: file(), 1: file() },
			'Map entry "1" points at "variables.f", which is not null in "operations".',
		);
	});
	test.each([
		['variables.__proto__.x'],
		['variables.constructor.prototype.x'],
		['variables.f.__proto__'],
		['variables.f.constructor'],
		['variables.prototype'],
	])('refuses %s and leaves Object.prototype untouched', (path) => {
		const operations = JSON.parse(
			'{"query":"q","variables":{"f":{"__proto__":null,"constructor":null,"prototype":null},"__proto__":{"x":null},"prototype":null}}',
		);
		const result = place(operations, { 0: [path] }, { 0: file() });
		expect(result).toEqual({
			ok: false,
			message: `Map entry "0" path "${path}" is not allowed.`,
		});
		expect(({} as Record<string, unknown>)['x']).toBeUndefined();
		expect(Object.keys(Object.prototype)).toEqual([]);
	});
	test('refuses a map key with no file part, and a file part not in the map', () => {
		refused(
			op({ f: null }),
			{ 0: ['variables.f'] },
			{},
			'Map entry "0" has no file part.',
		);
		refused(
			op({ f: null }),
			{ 0: ['variables.f'] },
			{ 0: file(), 1: file() },
			'File part "1" is not in "map".',
		);
	});
});

describe('parseMap', () => {
	const message =
		'The "map" field must be a JSON object of file field names to arrays of paths.';
	test.each([
		[null],
		['x'],
		[[]],
		[{ 0: 'variables.f' }],
		[{ 0: [] }],
		[{ 0: [1] }],
		[{ 0: [null] }],
	])('refuses %p', (value) => {
		expect(parseMap(value)).toEqual({ ok: false, message });
	});
	test('accepts an empty map and a good one', () => {
		expect(parseMap({}).ok).toBe(true);
		expect(parseMap({ 0: ['variables.f'] }).ok).toBe(true);
	});
});
