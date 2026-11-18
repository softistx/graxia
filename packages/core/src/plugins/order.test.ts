import { describe, expect, test } from 'bun:test';
import { GraxiaConfigError } from '../errors/config-error';
import { orderPlugins } from './order';

const p = (name: string, enforce?: 'pre' | 'post') => ({ name, enforce });

describe('orderPlugins', () => {
	test('pre, normal, post, stable inside a group', () => {
		const out = orderPlugins([
			p('a', 'post'),
			p('b'),
			p('c', 'pre'),
			p('d'),
			p('e', 'pre'),
		]);
		expect(out.map((x) => x.name)).toEqual(['c', 'e', 'b', 'd', 'a']);
	});

	test('duplicate name throws naming both indexes', () => {
		const run = () => orderPlugins([p('a'), p('b'), p('a')]);
		expect(run).toThrow(GraxiaConfigError);
		expect(run).toThrow(/"a" at indexes 0 and 2/);
	});

	test('config error code', () => {
		expect(new GraxiaConfigError('x').code).toBe('GRAXIA_CONFIG');
	});
});
