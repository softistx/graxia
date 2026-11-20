import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	buildIndex,
	FIX,
	INDEX_PATH,
	type IndexEntry,
	readIndex,
	render,
	sourceOf,
} from './plugin-index';

const entry = (over: Partial<IndexEntry> = {}): IndexEntry => ({
	name: '@x/a',
	version: '1.2.3',
	description: 'The a package',
	peers: [],
	subpaths: [{ path: '@x/a', names: ['b', 'A'] }],
	docs: [{ file: 'README.md', title: 'a' }],
	...over,
});

describe('render', () => {
	test('lists name, version, install line, peers, names and docs', () => {
		const out = render([
			entry({
				peers: [
					{ name: 'graphql', range: '^17.1.0', optional: false },
					{ name: 'typescript', range: '^6', optional: true },
				],
				subpaths: [
					{ path: '@x/a', names: ['createA'] },
					{ path: '@x/a/testing', names: [] },
				],
				docs: [
					{ file: 'README.md', title: '@x/a' },
					{ file: 'docs/guide/g.md', title: 'G' },
				],
			}),
		]);
		expect(out).toContain('## @x/a\n\nThe a package (1.2.3)');
		expect(out).toContain('- Install: `bun add @x/a graphql`');
		expect(out).toContain('`typescript` `^6` (optional)');
		expect(out).toContain('  - `@x/a`: `createA`');
		expect(out).toContain('  - `@x/a/testing`: no named export');
		expect(out).toContain('  - `node_modules/@x/a/docs/guide/g.md`: G');
	});

	test('a package without peers or docs still renders', () => {
		const out = render([entry({ docs: [] })]);
		expect(out).toContain('- Peers: none');
		expect(out).toContain('- Docs, in the installed package:\n');
	});

	test('sorts packages by name, is deterministic and has no absolute path', () => {
		const out = render([entry({ name: '@x/z' }), entry({ name: '@x/b' })]);
		expect(out.indexOf('## @x/b')).toBeLessThan(out.indexOf('## @x/z'));
		expect(render([entry()])).toBe(render([entry()]));
		expect(out).not.toContain('/Users/');
		expect(out.startsWith('<!-- GENERATED')).toBe(true);
	});

	test('sourceOf maps a built types path to its source', () => {
		expect(sourceOf('./dist/index.d.ts')).toBe('src/index.ts');
		expect(sourceOf('./dist/agent/index.d.ts')).toBe('src/agent/index.ts');
	});
});

describe('readIndex on a fixture workspace', () => {
	test('skips private packages and reads exported names from the source', () => {
		const root = mkdtempSync(join(tmpdir(), 'graxia-index-'));
		try {
			const pkg = (folder: string, extra: object) => {
				mkdirSync(join(root, 'packages', folder, 'src'), { recursive: true });
				writeFileSync(
					join(root, 'packages', folder, 'package.json'),
					JSON.stringify({
						name: `@x/${folder}`,
						version: '0.1.0',
						description: folder,
						exports: {
							'.': { types: './dist/index.d.ts' },
							'./package.json': './package.json',
						},
						...extra,
					}),
				);
				writeFileSync(
					join(root, 'packages', folder, 'src', 'index.ts'),
					'export const zed = 1;\nexport type Alpha = string;\nexport default 1;\n',
				);
			};
			pkg('pub', {});
			pkg('priv', { private: true });
			const entries = readIndex(root);
			expect(entries.map((e) => e.name)).toEqual(['@x/pub']);
			expect(entries[0]?.subpaths).toEqual([
				{ path: '@x/pub', names: ['Alpha', 'zed'] },
			]);
			expect(entries[0]?.docs).toEqual([]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe('the committed index', () => {
	test(`equals what plugin-index.ts generates now (${FIX})`, async () => {
		const committed = await Bun.file(
			join(import.meta.dir, '..', INDEX_PATH),
		).text();
		expect(committed, `${INDEX_PATH} is stale: ${FIX}`).toBe(buildIndex());
	});
});
