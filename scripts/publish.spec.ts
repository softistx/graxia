import { describe, expect, test } from 'bun:test';
import {
	inDependencyOrder,
	isAlreadyPublishedError,
	isPublished,
	releaseBlockers,
	workspaceRanges,
} from './publish';

describe('publish', () => {
	test('finds a workspace: range a pack left behind', () => {
		expect(
			workspaceRanges({
				name: 'x',
				peerDependencies: { '@graxia/core': 'workspace:^', graphql: '^17.0.0' },
			}),
		).toEqual(['peerDependencies.@graxia/core: workspace:^']);
		expect(workspaceRanges({ peerDependencies: { a: '^0.2.0' } })).toEqual([]);
	});

	test('orders dependencies first', () => {
		const order = inDependencyOrder([
			{ name: 'redis', deps: ['core', 'graphql'] },
			{ name: 'core', deps: ['graphql'] },
		]);
		expect(order.map((p) => p.name)).toEqual(['core', 'redis']);
	});

	test('reads the version from the registry document', async () => {
		const ok = (async () =>
			Response.json({ versions: { '0.1.0': {} } })) as unknown as typeof fetch;
		const missing = (async () =>
			new Response('', { status: 404 })) as unknown as typeof fetch;
		expect(await isPublished('@a/b', '0.1.0', ok)).toBe(true);
		expect(await isPublished('@a/b', '0.2.0', ok)).toBe(false);
		expect(await isPublished('@a/b', '0.1.0', missing)).toBe(false);
	});

	test('refuses pending changesets, and a 0.0.0 package', () => {
		const versioned = [{ name: 'a', version: '1.2.0' }];
		expect(releaseBlockers(['README.md', 'config.json'], versioned)).toEqual(
			[],
		);
		expect(releaseBlockers(['README.md', 'fix-it.md'], versioned)[0]).toContain(
			'fix-it.md',
		);
		expect(
			releaseBlockers(['README.md'], [{ name: 'b', version: '0.0.0' }]),
		).toEqual(['b is still 0.0.0: version it before publishing']);
	});

	test('treats a staged version as already published, nothing else', () => {
		expect(
			isAlreadyPublishedError(
				'npm error code E409\nnpm error 409 Conflict - PUT https://registry.npmjs.org/@graxia%2fcore - Cannot publish over previously staged version "0.2.0".',
			),
		).toBe(true);
		expect(
			isAlreadyPublishedError('npm error code E403\nnpm error 403 Forbidden'),
		).toBe(false);
		expect(isAlreadyPublishedError('npm error code E409\nconflict')).toBe(
			false,
		);
	});
});
