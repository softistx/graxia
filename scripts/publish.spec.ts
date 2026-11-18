import { describe, expect, test } from 'bun:test';
import { inDependencyOrder, isPublished, workspaceRanges } from './publish';

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
});
