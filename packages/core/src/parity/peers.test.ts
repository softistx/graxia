import { describe, expect, test } from 'bun:test';
import pkg from '../../package.json';

describe('what a host installs', () => {
	test('graphql 16 is outside the peer range, 17.1 inside', () => {
		const range = pkg.peerDependencies.graphql;
		expect(Bun.semver.satisfies('16.11.0', range)).toBe(false);
		expect(Bun.semver.satisfies('17.1.0', range)).toBe(true);
	});

	test('nothing to install beyond graphql', () => {
		const manifest = pkg as {
			dependencies?: Record<string, string>;
			peerDependencies: Record<string, string>;
			peerDependenciesMeta?: Record<string, { optional?: boolean }>;
		};
		expect(Object.keys(manifest.dependencies ?? {})).toEqual([]);
		expect(
			manifest.peerDependenciesMeta?.['@softistx/telemetry']?.optional,
		).toBe(true);
		const required = Object.keys(manifest.peerDependencies).filter(
			(name) => manifest.peerDependenciesMeta?.[name]?.optional !== true,
		);
		expect(required).toEqual(['graphql']);
		expect(Object.keys(manifest.peerDependencies)).not.toContain('graphql-ws');
	});
});
