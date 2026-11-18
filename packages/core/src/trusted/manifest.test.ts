import { describe, expect, test } from 'bun:test';
import { GraxiaConfigError } from '../errors/config-error';
import { hashOf, manifestKeys, sha256Hex, storeKey } from './apq';
import { normalizeManifest } from './manifest';

describe('normalizeManifest', () => {
	test('reads a plain object (Relay, graphql-codegen)', () => {
		const map = normalizeManifest({ a1: '{ hello }', b2: '{ who }' });
		expect([...map]).toEqual([
			['a1', '{ hello }'],
			['b2', '{ who }'],
		]);
	});

	test('reads an Apollo persisted query manifest', () => {
		const map = normalizeManifest({
			format: 'apollo-persisted-query-manifest',
			version: 1,
			operations: [
				{ id: 'x', body: '{ hello }', name: 'Hello', type: 'query' },
			],
		});
		expect(map.get('x')).toBe('{ hello }');
	});

	test('reads a Map', () => {
		expect(normalizeManifest(new Map([['k', '{ hello }']])).get('k')).toBe(
			'{ hello }',
		);
	});

	test.each([
		['a string', 'nope', 'must be a Map, an object'],
		['an array', [], 'must be a Map, an object'],
		[
			'a non-string source',
			{ a: 1 },
			'the entry "a" must map to a GraphQL source string',
		],
		['a blank source', { a: ' ' }, 'the entry "a" must map'],
		[
			'an Apollo manifest of another version',
			{ format: 'apollo-persisted-query-manifest', version: 2, operations: [] },
			'"version" must be 1',
		],
		[
			'an Apollo manifest without operations',
			{ format: 'apollo-persisted-query-manifest', version: 1 },
			'"operations" must be a list of { id, body }',
		],
		[
			'an Apollo operation without a body',
			{
				format: 'apollo-persisted-query-manifest',
				version: 1,
				operations: [{ id: 'x' }],
			},
			'the entry "x" must map',
		],
	])('refuses %s', (_, manifest, message) => {
		expect(() => normalizeManifest(manifest)).toThrow(GraxiaConfigError);
		expect(() => normalizeManifest(manifest)).toThrow(message);
	});
});

describe('manifest hash ids', () => {
	test('an upper-case hex id is indexed in lower case', () => {
		const hex = sha256Hex('{ hello }');
		const map = normalizeManifest({ [hex.toUpperCase()]: '{ hello }' });
		expect(map.get(hex)).toBe('{ hello }');
		expect(map.has(hex.toUpperCase())).toBe(false);
	});
});

describe('hash keys', () => {
	const hex = sha256Hex('{ hello }');

	test('a hash is found as <hex> and as sha256:<hex>', () => {
		expect(manifestKeys(hex)).toEqual([hex, `sha256:${hex}`]);
		expect(manifestKeys(`sha256:${hex}`)).toEqual([`sha256:${hex}`, hex]);
		expect(manifestKeys('opaque')).toEqual(['opaque']);
	});

	test('the store key is the same for both spellings, in lower case', () => {
		expect(storeKey(`sha256:${hex.toUpperCase()}`)).toBe(storeKey(hex));
		expect(hashOf('opaque')).toBeUndefined();
	});
});
