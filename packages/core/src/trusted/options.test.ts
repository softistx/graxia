import { afterEach, describe, expect, test } from 'bun:test';
import { createGraxia } from '../server/create-graxia';
import { schema } from '../server/fixtures.test-util';
import { resolveTrusted } from './options';

const make = (trustedDocuments: unknown) => () =>
	createGraxia({ schema, trustedDocuments: trustedDocuments as never });

const env = process.env['NODE_ENV'];
afterEach(() => {
	if (env === undefined) delete process.env['NODE_ENV'];
	else process.env['NODE_ENV'] = env;
});

describe('trustedDocuments options', () => {
	test('absent: off', () => {
		expect(resolveTrusted(undefined)).toBeUndefined();
	});

	test.each([
		['a string', 'x', 'trustedDocuments must be an object'],
		[
			'a bad mode',
			{ mode: 'loose' },
			'trustedDocuments.mode must be "strict" or "mixed"',
		],
		['a bad apq', { apq: 1 }, 'trustedDocuments.apq must be a boolean'],
		[
			'a bad store',
			{ store: {} },
			'trustedDocuments.store must be a KeyValueCache (get, set and delete)',
		],
		[
			'a store without delete',
			{ store: { get() {}, set() {} } },
			'trustedDocuments.store must be a KeyValueCache',
		],
		[
			'a bad extractKey',
			{ extractKey: 1 },
			'trustedDocuments.extractKey must be a function',
		],
		[
			'strict with nothing to run',
			{ mode: 'strict' },
			'needs a manifest, or extractKey with a store',
		],
		['a bad manifest', { manifest: 3 }, 'trustedDocuments.manifest must be'],
	])('refuses %s', (_, value, message) => {
		expect(make(value)).toThrow(message);
	});

	test('the mode follows NODE_ENV, read at creation', () => {
		process.env['NODE_ENV'] = 'production';
		expect(resolveTrusted({ manifest: {} })?.mode).toBe('strict');
		process.env['NODE_ENV'] = 'development';
		expect(resolveTrusted({ manifest: {} })?.mode).toBe('mixed');
		expect(resolveTrusted({ manifest: {}, mode: 'strict' })?.mode).toBe(
			'strict',
		);
	});

	test('apq is on in mixed with a memory store, never in strict', () => {
		const mixed = resolveTrusted({ mode: 'mixed' });
		expect(mixed?.apq).toBe(true);
		expect(mixed?.store).toBeDefined();
		expect(
			resolveTrusted({ mode: 'mixed', apq: false })?.store,
		).toBeUndefined();
		const strict = resolveTrusted({ mode: 'strict', manifest: {}, apq: true });
		expect(strict?.apq).toBe(false);
		expect(strict?.store).toBeUndefined();
	});
});
