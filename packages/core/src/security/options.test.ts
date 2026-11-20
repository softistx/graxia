import { describe, expect, test } from 'bun:test';
import { GraxiaConfigError } from '../errors/config-error';
import { createGraxia } from '../server/create-graxia';
import { schema } from '../server/fixtures.test-util';

const build = (options: Record<string, unknown>) => () =>
	createGraxia({ schema, ...options } as never);

describe('security option errors', () => {
	test.each([
		[
			{ csrf: true },
			'csrf must be false or an object ({ requireHeader, sameOrigin })',
		],
		[
			{ csrf: { requireHeader: 'x' } },
			'csrf.requireHeader must be a boolean or a non-empty list of header names',
		],
		[
			{ csrf: { requireHeader: [] } },
			'csrf.requireHeader must be a boolean or a non-empty list of header names',
		],
		[
			{ csrf: { requireHeader: ['bad name'] } },
			'csrf.requireHeader must be a boolean or a non-empty list of header names',
		],
		[
			{ csrf: { sameOrigin: 'yes' } },
			'csrf.sameOrigin must be a boolean or an object ({ allowedOrigins, crossOrigin })',
		],
		[
			{ csrf: { sameOrigin: { crossOrigin: 'maybe' } } },
			'csrf.sameOrigin.crossOrigin must be "refuse", "json" or "allow"',
		],
		[
			{ csrf: { sameOrigin: { allowedOrigins: 'https://a.test' } } },
			'csrf.sameOrigin.allowedOrigins must be a list of origins (e.g. "https://app.example.com")',
		],
		[
			{ csrf: { sameOrigin: { allowedOrigins: ['https://a.test/path'] } } },
			'csrf.sameOrigin.allowedOrigins entry "https://a.test/path" is not an origin (use scheme, host and optional port, no path: "https://app.example.com")',
		],
		[
			{ csrf: { sameOrigin: { refuse: 'nope' } } },
			'csrf.sameOrigin.refuse must be a function ((request, reason) => Response)',
		],
		[{ introspection: 'no' }, 'introspection must be a boolean'],
		[{ suggestions: 1 }, 'suggestions must be a boolean'],
	])('%j', (options, message) => {
		expect(build(options)).toThrow(GraxiaConfigError);
		expect(build(options)).toThrow(message);
	});

	test('valid shapes are accepted', () => {
		expect(
			build({
				csrf: {
					requireHeader: ['X-A'],
					sameOrigin: {
						allowedOrigins: ['https://a.test:8443'],
						crossOrigin: 'json',
					},
				},
			}),
		).not.toThrow();
	});
});
