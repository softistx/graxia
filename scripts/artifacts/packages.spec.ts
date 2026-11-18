import { describe, expect, test } from 'bun:test';
import { subpathsOf } from './packages';

describe('subpathsOf', () => {
	test('names every exported subpath, and not package.json', () => {
		expect(
			subpathsOf('@softistx/mongo', {
				'.': {},
				'./gridfs': {},
				'./migrations': {},
				'./package.json': './package.json',
			}),
		).toEqual([
			'@softistx/mongo',
			'@softistx/mongo/gridfs',
			'@softistx/mongo/migrations',
		]);
	});
});
