import { describe, expect, test } from 'bun:test';
import { paramsFromJson, paramsFromUrl } from './params';

describe('paramsFromJson', () => {
	test('accepts a full object and null optionals', () => {
		expect(
			paramsFromJson({
				query: '{ a }',
				operationName: 'A',
				variables: { x: 1 },
				extensions: { y: 2 },
			}),
		).toEqual({
			ok: true,
			params: {
				query: '{ a }',
				operationName: 'A',
				variables: { x: 1 },
				extensions: { y: 2 },
			},
		});
		expect(
			paramsFromJson({
				query: '{ a }',
				operationName: null,
				variables: null,
				extensions: null,
			}),
		).toEqual({ ok: true, params: { query: '{ a }' } });
	});
	test('a missing query is left to the pipeline', () => {
		expect(paramsFromJson({ other: 1 })).toEqual({ ok: true, params: {} });
	});
	test.each([
		['non-object', 'x'],
		['null', null],
		['array', []],
		['query type', { query: 1 }],
		['operationName type', { query: 'q', operationName: 1 }],
		['variables string', { query: 'q', variables: 'x' }],
		['variables array', { query: 'q', variables: [] }],
		['extensions number', { query: 'q', extensions: 0 }],
	])('rejects %s', (_name, value) => {
		expect(paramsFromJson(value).ok).toBe(false);
	});
});

describe('paramsFromUrl', () => {
	test('decodes query, operationName and JSON parameters', () => {
		const url = new URL('http://x/graphql');
		url.searchParams.set('query', 'query A($n: String!) { a }');
		url.searchParams.set('operationName', 'A');
		url.searchParams.set('variables', '{"n":"v"}');
		url.searchParams.set('extensions', '{"e":1}');
		expect(paramsFromUrl(url)).toEqual({
			ok: true,
			params: {
				query: 'query A($n: String!) { a }',
				operationName: 'A',
				variables: { n: 'v' },
				extensions: { e: 1 },
			},
		});
	});
	test('rejects invalid JSON and wrong shapes', () => {
		expect(paramsFromUrl(new URL('http://x/?query=a&variables=%7B')).ok).toBe(
			false,
		);
		expect(paramsFromUrl(new URL('http://x/?query=a&extensions=1')).ok).toBe(
			false,
		);
	});
	test('a variables object that looks like a failure is data', () => {
		const url = new URL('http://x/?query=a');
		url.searchParams.set('variables', '{"ok":false,"message":"m"}');
		expect(paramsFromUrl(url).ok).toBe(true);
	});
});
