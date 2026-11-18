import { describe, expect, test } from 'bun:test';
import { fieldRateLimit } from './plugin';
import { memoryFieldLimit } from './store';

const limit = memoryFieldLimit({ limit: 1, windowMs: 1 });

describe('fieldRateLimit options', () => {
	test.each([
		[
			{ fields: {} },
			'fieldRateLimit: fields must be an object with at least one field name',
		],
		[
			{ fields: undefined },
			'fieldRateLimit: fields must be an object with at least one field name',
		],
		[
			{ fields: { a: {} } },
			'fieldRateLimit: fields.a must be a limit ({ consume }) or { limit, single? }',
		],
		[
			{ fields: { a: { limit, single: 'yes' } } },
			'fieldRateLimit: fields.a must be a limit ({ consume }) or { limit, single? }',
		],
		[
			{ fields: { a: limit }, ipv6Prefix: 129 },
			'fieldRateLimit: ipv6Prefix must be an integer from 0 to 128',
		],
		[
			{ fields: { a: limit }, ipv6Prefix: 1.5 },
			'fieldRateLimit: ipv6Prefix must be an integer from 0 to 128',
		],
		[
			{ fields: { a: limit }, ipv6Prefix: 64, key: () => 'k' },
			'fieldRateLimit: ipv6Prefix only applies to the default key; reduce the address inside key() instead',
		],
		[
			{ fields: { a: limit }, code: '' },
			'fieldRateLimit: code must be a non-empty string',
		],
	] as const)('%j', (options, message) => {
		expect(() => fieldRateLimit(options as never)).toThrow(message);
	});

	test('valid options build a plugin that runs first', () => {
		const plugin = fieldRateLimit({
			fields: { a: { limit, single: true } },
			ipv6Prefix: 0,
		});
		expect(plugin.enforce).toBe('pre');
		expect(typeof plugin.onExecute).toBe('function');
		expect(typeof plugin.onSubscribe).toBe('function');
	});
});
