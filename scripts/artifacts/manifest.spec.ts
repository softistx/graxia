import { describe, expect, test } from 'bun:test';
import { accessProblems, manifestShapeProblems } from './manifest';

describe('manifestShapeProblems', () => {
	const adapter = (
		peerDependencies: Record<string, string>,
		name = '@softistx/mongo-meilisearch',
	) => ({
		name,
		peerDependencies,
	});

	test('accepts a caret range on a sibling', () => {
		expect(
			manifestShapeProblems([
				{ name: '@softistx/mongo' },
				adapter({ '@softistx/mongo': '^0.2.0' }),
			]),
		).toEqual([]);
	});

	test('refuses an exact pin on a sibling: two copies, two ValidationError classes', () => {
		const problems = manifestShapeProblems([
			{ name: '@softistx/mongo' },
			adapter({ '@softistx/mongo': '0.2.0' }),
		]);
		expect(problems).toEqual([
			expect.stringContaining('pins a sibling exactly'),
		]);
	});

	test('refuses a package that lists itself', () => {
		const problems = manifestShapeProblems([
			{ name: '@softistx/mongo', dependencies: { '@softistx/mongo': '.' } },
		]);
		expect(problems).toEqual([expect.stringContaining('lists itself')]);
	});

	/** `bun pm pack` resolves every `workspace:`; one left means it did not. */
	test('refuses a workspace: left in a field a consumer installs, and not in devDependencies', () => {
		expect(
			manifestShapeProblems([
				{ name: '@softistx/mongo' },
				{
					name: '@softistx/mongo-meilisearch',
					peerDependencies: { '@softistx/mongo': 'workspace:^' },
					devDependencies: { '@softistx/mongo': 'workspace:^' },
				},
			]),
		).toEqual([
			'@softistx/mongo-meilisearch: peerDependencies.@softistx/mongo = workspace:^, ' +
				'which `bun pm pack` should have resolved',
		]);
	});

	test('refuses link: and file: where a consumer installs, and not in devDependencies', () => {
		expect(
			manifestShapeProblems([
				{
					name: '@softistx/mongo',
					dependencies: { a: 'link:../a' },
					optionalDependencies: { b: 'file:../b' },
					devDependencies: { c: 'link:../c' },
				},
			]),
		).toEqual([
			'@softistx/mongo: dependencies.a = link:../a',
			'@softistx/mongo: optionalDependencies.b = file:../b',
		]);
	});
});

describe('accessProblems', () => {
	test('accepts a public package', () => {
		expect(
			accessProblems({
				name: '@softistx/graxia',
				publishConfig: { access: 'public' },
			}),
		).toEqual([]);
	});

	test('refuses a restricted package', () => {
		expect(
			accessProblems({
				name: '@softistx/graxia',
				publishConfig: { access: 'restricted' },
			}),
		).toHaveLength(1);
	});

	test('refuses another registry', () => {
		expect(
			accessProblems({
				name: '@softistx/graxia',
				publishConfig: {
					registry: 'https://npm.softistx.com',
					access: 'public',
				},
			}),
		).toHaveLength(1);
	});

	test('refuses a package with no publishConfig', () => {
		expect(accessProblems({ name: '@softistx/graxia' })).toHaveLength(1);
	});
});
