import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { $ } from 'bun';
import { affected, changedSince, readNodes } from './affected';
import { ROOT } from './artifacts/packages';

const scratch: string[] = [];
afterAll(() => {
	for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

describe('affected', () => {
	const at = (dir: string) => `${ROOT}/${dir}`;
	const nodes = [
		{ name: '@softistx/mongo', dir: at('packages/mongo'), needs: [] },
		{
			name: '@softistx/mongo-backup',
			dir: at('packages/mongo-backup'),
			needs: ['@softistx/mongo'],
		},
		{
			name: 'example-job',
			dir: at('examples/job'),
			needs: ['@softistx/mongo-backup'],
		},
		{ name: '@softistx/s3', dir: at('packages/s3'), needs: [] },
	];
	const names = (changed: string[]) => [...(affected(nodes, changed) ?? [])];

	test('a member and everything that needs it, transitively', () => {
		expect(names(['packages/mongo/src/a.ts']).sort()).toEqual([
			'@softistx/mongo',
			'@softistx/mongo-backup',
			'example-job',
		]);
		expect(names(['packages/mongo-backup/README.md']).sort()).toEqual([
			'@softistx/mongo-backup',
			'example-job',
		]);
	});

	test('a leaf runs alone', () => {
		expect(names(['packages/s3/src/a.ts'])).toEqual(['@softistx/s3']);
		expect(names(['examples/job/src/a.ts'])).toEqual(['example-job']);
	});

	test('docs, changesets and notes run nothing', () => {
		expect(
			names(['docs/guide.md', '.changeset/x.md', 'AGENTS.md', 'LICENSE']),
		).toEqual([]);
	});

	test('a root file runs everything', () => {
		for (const file of [
			'bun.lock',
			'package.json',
			'tsconfig.base.json',
			'biome.json',
			'build.ts',
			'.github/workflows/ci.yml',
			'scripts/affected.ts',
		]) {
			expect(affected(nodes, [file])).toBeUndefined();
		}
		expect(affected(nodes, ['packages/s3/a.ts', 'bun.lock'])).toBeUndefined();
	});

	test('a path under packages/ or examples/ that no member owns runs everything', () => {
		expect(affected(nodes, ['packages/gone/a.ts'])).toBeUndefined();
		expect(affected(nodes, ['examples/gone/a.ts'])).toBeUndefined();
	});
});

describe('readNodes', () => {
	test('reads the packages, a dependent naming its needs', async () => {
		const all = await readNodes();
		const redis = all.find((node) => node.name === '@graxia/redis');
		expect(redis?.needs).toContain('@graxia/core');
	});
});

describe('changedSince', () => {
	test('a rename across packages lists both paths', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'affected-'));
		scratch.push(dir);
		const git = (...args: string[]) => $`git ${args}`.cwd(dir).quiet();
		await git('init', '-q', '-b', 'develop');
		await git('config', 'user.email', 'a@b.c');
		await git('config', 'user.name', 'x');
		await git('config', 'commit.gpgsign', 'false');
		await $`mkdir -p packages/a packages/b`.cwd(dir);
		writeFileSync(
			join(dir, 'packages/a/f.ts'),
			'export const f = 1;\n'.repeat(20),
		);
		await git('add', '-A');
		await git('commit', '-qm', 'base');
		await git('checkout', '-qb', 'work');
		await git('mv', 'packages/a/f.ts', 'packages/b/f.ts');
		await git('commit', '-qam', 'move');
		expect((await changedSince('develop', dir)).sort()).toEqual([
			'packages/a/f.ts',
			'packages/b/f.ts',
		]);
	});
});

describe('the command line', () => {
	const run = async (...args: string[]) => {
		const outDir = mkdtempSync(join(tmpdir(), 'affected-out-'));
		scratch.push(outDir);
		const out = join(outDir, 'output');
		writeFileSync(out, '');
		const result = await $`bun ${join(ROOT, 'scripts/affected.ts')} ${args}`
			.cwd(ROOT)
			.env({ ...process.env, ['GITHUB_OUTPUT']: out })
			.nothrow()
			.quiet();
		return {
			code: result.exitCode,
			stdout: result.stdout.toString(),
			out: readFileSync(out, 'utf8'),
		};
	};

	test('every member: the server flags and the package count are written', async () => {
		const { code, out } = await run('--github-output');
		expect(code).toBe(0);
		expect(out).toContain('mongo=false\n');
		expect(out).toContain('redis=false\n');
		expect(out).toMatch(/packages=[1-9]\d*\n/);
	});

	test('an empty selection exits 0 and writes false and 0', async () => {
		const { code, out, stdout } = await run(
			'--since=HEAD',
			'--github-output',
			'--run',
			'test',
		);
		expect(code).toBe(0);
		expect(out).toBe(
			'mongo=false\nmeilisearch=false\nseaweedfs=false\nredis=false\npackages=0\n',
		);
		expect(stdout).toContain('nothing to run');
	});
});
