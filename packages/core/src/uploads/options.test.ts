import { describe, expect, test } from 'bun:test';
import { GraxiaConfigError } from '../errors/config-error';
import { resolveCsrf } from '../security/options';
import { createGraxia } from '../server/create-graxia';
import { schema } from '../server/fixtures.test-util';
import { resolveUploads } from './options';

const build = (options: Record<string, unknown>) => () =>
	createGraxia({ schema, ...options } as never);
const csrf = resolveCsrf(undefined);

describe('resolveUploads', () => {
	test('off by default and when false', () => {
		expect(resolveUploads(undefined, csrf)).toEqual({ uploads: false });
		expect(resolveUploads(false, csrf)).toEqual({ uploads: false });
	});
	test('true takes the defaults', () => {
		expect(resolveUploads(true, csrf)).toEqual({
			uploads: { bodyBytes: 16 << 20, fileBytes: 8 << 20, files: 10 },
		});
	});
	test('a small bodyBytes lowers the default fileBytes', () => {
		expect(resolveUploads({ bodyBytes: 1000 }, csrf)).toEqual({
			uploads: { bodyBytes: 1000, fileBytes: 1000, files: 10 },
		});
	});
	test.each([
		[{ bodyBytes: 0 }, 'uploads.bodyBytes must be a positive integer'],
		[{ bodyBytes: 1.5 }, 'uploads.bodyBytes must be a positive integer'],
		[{ files: 0 }, 'uploads.files must be a positive integer'],
		[
			{ fileBytes: -1 },
			'uploads.fileBytes must be a positive integer no larger than uploads.bodyBytes',
		],
		[
			{ bodyBytes: 10, fileBytes: 11 },
			'uploads.fileBytes must be a positive integer no larger than uploads.bodyBytes',
		],
		[
			'on',
			'uploads must be a boolean or an object ({ bodyBytes, fileBytes, files })',
		],
	])('refuses %p', (uploads, message) => {
		expect(() => resolveUploads(uploads, csrf)).toThrow(message);
	});
});

describe('uploads and CSRF prevention', () => {
	const message =
		'uploads need CSRF prevention: a browser can post multipart/form-data cross-site without a preflight. Keep csrf.requireHeader on (the default), or turn uploads off.';
	test.each([
		[{ uploads: true, csrf: false }],
		[{ uploads: true, csrf: { requireHeader: false } }],
	])('refuses %p at boot', (options) => {
		expect(build(options)).toThrow(GraxiaConfigError);
		expect(build(options)).toThrow(message);
	});
	test('accepts the default and a custom header list', () => {
		expect(build({ uploads: true })).not.toThrow();
		expect(
			build({ uploads: true, csrf: { requireHeader: ['x-up'] } }),
		).not.toThrow();
	});
	test('csrf off is fine while uploads are off', () => {
		expect(build({ csrf: false })).not.toThrow();
	});
});
