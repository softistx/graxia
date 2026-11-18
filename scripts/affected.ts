/**
 * The workspace members a pull request's CI has to type-check and test: those
 * holding a changed file, plus every member that needs one of them
 * (transitively, over dependencies, devDependencies, peers and optional
 * peers) — a dependent is checked against the change. Members are the
 * packages and the examples.
 *
 *   bun scripts/affected.ts --since=origin/develop            # one dir per line
 *   bun scripts/affected.ts --since=origin/develop --run test # run it, in order
 *   bun scripts/affected.ts --since=origin/develop --github-output
 *
 * Without `--since` every member is listed. A file outside `packages/` and
 * `examples/` that can change any result (the lockfile, root manifest,
 * tsconfigs, Biome, `build.ts`, `.github/`, `scripts/`) selects every member,
 * and so does a path under `packages/` or `examples/` that no member owns.
 *
 * `--run <script>` runs the script in each selected member, a member only once
 * every selected sibling it needs has run it (`waves()` of workspace.ts, the
 * order `bun run build` uses). `--github-output` appends `mongo=`,
 * `meilisearch=`, `seaweedfs=`, `redis=` and `packages=` lines to
 * `$GITHUB_OUTPUT`: whether a selected member's specs start that server, and
 * how many packages (examples left out) are selected, so CI restores, builds and verifies only what
 * the selection needs.
 */
import { appendFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { $ } from 'bun';
import { ROOT } from './artifacts/packages';
import { waves } from './workspace';

export interface Node {
	readonly name: string;
	readonly dir: string;
	readonly needs: readonly string[];
}

const FIELDS = [
	'dependencies',
	'devDependencies',
	'peerDependencies',
	'optionalDependencies',
] as const;

/**
 * Paths that belong to no member and change no build, test or type: docs,
 * changesets, licence, notes. Everything else outside `packages/` and
 * `examples/` (the lockfile, root manifest, tsconfigs, Biome, `build.ts`,
 * `bunfig.toml`, `.github/`, `scripts/`) can change any member's result.
 */
const INERT = [
	/^docs\//,
	/^\.changeset\//,
	/^\.claude\//,
	/^[^/]+\.md$/,
	/^LICENSE$/,
	/^\.gitignore$/,
	/^\.nxgt-issues\.json$/,
];

/**
 * The names to run for the files changed. `undefined` means everything: a file
 * outside the members that can change any of them changed, or one under
 * `packages/` or `examples/` that no workspace member owns.
 */
export function affected(
	nodes: readonly Node[],
	changed: readonly string[],
): Set<string> | undefined {
	const roots = new Set<string>();
	for (const file of changed) {
		const owner = nodes.find((node) =>
			file.startsWith(`${relative(ROOT, node.dir)}/`),
		);
		if (owner !== undefined) roots.add(owner.name);
		else if (file.startsWith('packages/') || file.startsWith('examples/')) {
			return undefined;
		} else if (!INERT.some((pattern) => pattern.test(file))) return undefined;
	}
	let grew = true;
	while (grew) {
		grew = false;
		for (const node of nodes) {
			if (roots.has(node.name)) continue;
			if (node.needs.some((need) => roots.has(need))) {
				roots.add(node.name);
				grew = true;
			}
		}
	}
	return roots;
}

/** The files changed on this branch since it left `ref`. */
export async function changedSince(
	ref: string,
	cwd: string = ROOT,
): Promise<string[]> {
	const run = await $`git diff --name-only --no-renames ${ref}...HEAD`
		.cwd(cwd)
		.quiet();
	return run.stdout.toString().split('\n').filter(Boolean);
}

/** The workspace members under `packages/` and `examples/`, in a stable order. */
export async function readNodes(): Promise<Node[]> {
	const nodes: Node[] = [];
	for (const rel of [
		...new Bun.Glob('{packages,examples}/*/package.json').scanSync(ROOT),
	].sort()) {
		const manifest = await Bun.file(join(ROOT, rel)).json();
		const needs = new Set<string>();
		for (const field of FIELDS) {
			for (const name of Object.keys(manifest[field] ?? {})) needs.add(name);
		}
		needs.delete(manifest['name']);
		nodes.push({
			name: manifest['name'],
			dir: join(ROOT, rel.replace(/\/package\.json$/, '')),
			needs: [...needs],
		});
	}
	return nodes;
}

/** A member's `test` script, empty when it has none. */
async function testScript(node: Node): Promise<string> {
	const manifest = await Bun.file(join(node.dir, 'package.json')).json();
	return manifest['scripts']?.['test'] ?? '';
}

/** Whether a member's specs start the pinned Redis (`scripts/redis.ts`). */
export async function usesRedis(node: Node): Promise<boolean> {
	return (await testScript(node)).includes('scripts/redis.ts');
}

/** Whether a member's specs start Meilisearch (`scripts/meilisearch.ts`). */
export async function usesMeilisearch(node: Node): Promise<boolean> {
	return (await testScript(node)).includes('scripts/meilisearch.ts');
}

/** Whether a member's specs start SeaweedFS (`scripts/seaweedfs.ts`). */
export async function usesSeaweedfs(node: Node): Promise<boolean> {
	return (await testScript(node)).includes('scripts/seaweedfs.ts');
}

/** Whether a member's sources or tests start a mongod (`mongodb-memory-server`). */
export async function usesMongo(node: Node): Promise<boolean> {
	for (const rel of new Bun.Glob('{src,test}/**/*.ts').scanSync(node.dir)) {
		if (
			(await Bun.file(join(node.dir, rel)).text()).includes(
				'mongodb-memory-server',
			)
		) {
			return true;
		}
	}
	return false;
}

/** Runs `script` in the selected members, wave by wave; the exit code. */
async function runWaves(
	picked: readonly Node[],
	script: string,
): Promise<number> {
	for (const wave of waves(picked)) {
		const results = await Promise.all(
			wave.map(async (node) => {
				const run = await $`bun run ${script}`.cwd(node.dir).nothrow().quiet();
				const output = `${run.stdout}${run.stderr}`.trim();
				if (output) console.log(output.replace(/^/gm, `${node.name}: `));
				return run.exitCode === 0 ? undefined : node.name;
			}),
		);
		const failed = results.filter((name) => name !== undefined);
		if (failed.length > 0) {
			console.error(`${script} failed in ${failed.join(', ')}`);
			return 1;
		}
	}
	return 0;
}

if (import.meta.main) {
	const args = process.argv.slice(2);
	const since = args.find((arg) => arg.startsWith('--since='));
	const run = args.indexOf('--run');
	const script = run === -1 ? undefined : args[run + 1];
	if (run !== -1 && script === undefined) {
		console.error(
			'Usage: bun scripts/affected.ts [--since=<ref>] --run <script>',
		);
		process.exit(1);
	}
	const nodes = await readNodes();
	let only: Set<string> | undefined;
	if (since !== undefined) {
		const changed = await changedSince(since.slice('--since='.length));
		only = affected(nodes, changed);
		console.error(
			only === undefined
				? `${changed.length} changed file(s), a root file among them: every member.`
				: `${changed.length} changed file(s): ${only.size} member(s) affected.`,
		);
	}
	const picked = nodes.filter(
		(node) => only === undefined || only.has(node.name),
	);
	if (args.includes('--github-output') && process.env['GITHUB_OUTPUT']) {
		const any = async (uses: (node: Node) => Promise<boolean>) =>
			(await Promise.all(picked.map(uses))).some(Boolean);
		appendFileSync(
			process.env['GITHUB_OUTPUT'],
			[
				`mongo=${await any(usesMongo)}`,
				`meilisearch=${await any(usesMeilisearch)}`,
				`seaweedfs=${await any(usesSeaweedfs)}`,
				`redis=${await any(usesRedis)}`,
				`packages=${picked.filter((node) => relative(ROOT, node.dir).startsWith('packages/')).length}`,
				'',
			].join('\n'),
		);
	}
	if (script === undefined) {
		for (const node of picked) console.log(relative(ROOT, node.dir));
	} else if (picked.length === 0) {
		console.log(`${script}: no member affected, nothing to run.`);
	} else {
		process.exit(await runWaves(picked, script));
	}
}
