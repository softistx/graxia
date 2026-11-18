#!/usr/bin/env bun
/**
 * Publishes every public package whose version is not on npm yet, in
 * dependency order.
 *
 * This replaces `changeset publish`, which falls back to a plain `npm publish`
 * in the package directory: npm does not rewrite `workspace:^`, so
 * `@graxia/redis` would ship `peerDependencies["@graxia/core"]: "workspace:^"`.
 * Here each package is packed with `bun pm pack` (which rewrites the range),
 * the packed manifest is asserted to hold no `workspace:` range, and that
 * tarball is what `npm publish` uploads. A version already on npm is skipped,
 * so a re-run is safe. It refuses to run while changesets are pending or a
 * package is still 0.0.0: the Version PR must be merged first. It does not tag:
 * after the merge, from an up-to-date `develop`, run
 * `bunx changeset git-tag && git push --follow-tags`.
 *
 * `--dry-run` packs and asserts, and publishes nothing; it refuses the same way.
 * Credentials: `NODE_AUTH_TOKEN` (set by `publish.yml`); provenance is on when
 * the workflow has `id-token: write` (`GITHUB_ACTIONS`).
 */
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { $ } from 'bun';
import { type Pkg, ROOT, readPackages } from './artifacts/packages';
import { readTarball } from './artifacts/tarball';

const FIELDS = [
	'dependencies',
	'peerDependencies',
	'optionalDependencies',
] as const;

/** Every `workspace:` range left in a packed manifest's installable fields. */
export function workspaceRanges(manifest: Record<string, unknown>): string[] {
	return FIELDS.flatMap((field) =>
		Object.entries((manifest[field] as Record<string, string>) ?? {})
			.filter(([, range]) => range.startsWith('workspace:'))
			.map(([dep, range]) => `${field}.${dep}: ${range}`),
	);
}

/**
 * npm answers E409 "Cannot publish over previously staged version" when the
 * version was just published and is not yet visible on the registry (several
 * tag runs of one commit): the version is on its way, not a failure.
 */
export function isAlreadyPublishedError(stderr: string): boolean {
	return (
		/E409|409 Conflict/i.test(stderr) &&
		/previously staged version|cannot publish over/i.test(stderr)
	);
}

/** Dependencies first, so a consumer is never on npm before what it needs. */
export function inDependencyOrder<T extends { name: string; deps: string[] }>(
	pkgs: readonly T[],
): T[] {
	const names = new Set(pkgs.map((p) => p.name));
	const done = new Set<string>();
	const order: T[] = [];
	while (order.length < pkgs.length) {
		const ready = pkgs.filter(
			(p) =>
				!done.has(p.name) && p.deps.every((d) => !names.has(d) || done.has(d)),
		);
		if (ready.length === 0)
			throw new Error('dependency cycle between packages');
		for (const p of ready) {
			order.push(p);
			done.add(p.name);
		}
	}
	return order;
}

/** Whether npm already holds this exact version (a 404 means never published). */
export async function isPublished(
	name: string,
	version: string,
	fetcher: typeof fetch = fetch,
): Promise<boolean> {
	const res = await fetcher(
		`https://registry.npmjs.org/${name.replace('/', '%2F')}`,
	);
	if (res.status === 404) return false;
	if (!res.ok) throw new Error(`${name}: npm answered ${res.status}`);
	const doc = (await res.json()) as { versions?: Record<string, unknown> };
	return doc.versions?.[version] !== undefined;
}

/** Why nothing may be published yet: unversioned changesets, or a package never versioned. */
export function releaseBlockers(
	changesetFiles: readonly string[],
	packages: readonly { name: string; version: string }[],
): string[] {
	const pending = changesetFiles.filter(
		(file) => file.endsWith('.md') && file !== 'README.md',
	);
	return [
		...(pending.length > 0
			? [
					`${pending.length} changeset(s) are not versioned yet (${pending.join(', ')}): merge the Version PR (bun run changeset:version) first`,
				]
			: []),
		...packages
			.filter((p) => p.version === '0.0.0')
			.map((p) => `${p.name} is still 0.0.0: version it before publishing`),
	];
}

type Publishable = Pkg & { deps: string[] };

async function publishable(): Promise<Publishable[]> {
	const out: Publishable[] = [];
	for (const pkg of await readPackages()) {
		const manifest = await Bun.file(join(pkg.dir, 'package.json')).json();
		if (manifest.private) continue;
		const deps = FIELDS.flatMap((f) => Object.keys(manifest[f] ?? {}));
		out.push({ ...pkg, deps });
	}
	return inDependencyOrder(out);
}

async function main(): Promise<void> {
	const dryRun = process.argv.includes('--dry-run');
	const packages = await publishable();
	const blockers = releaseBlockers(
		await readdir(join(ROOT, '.changeset')),
		packages,
	);
	if (blockers.length > 0) {
		for (const blocker of blockers) console.error(`  refused   ${blocker}`);
		process.exit(1);
	}
	const workdir = await mkdtemp(join(tmpdir(), 'graxia-publish-'));
	let published = 0;
	try {
		for (const pkg of packages) {
			if (await isPublished(pkg.name, pkg.version)) {
				console.log(`  skip      ${pkg.name}@${pkg.version} (already on npm)`);
				continue;
			}
			const dest = join(workdir, pkg.name.replace(/\W+/g, '-'));
			await $`bun pm pack --destination ${dest}`.cwd(pkg.dir).quiet();
			const tgz = [...new Bun.Glob('*.tgz').scanSync(dest)][0];
			if (!tgz) throw new Error(`${pkg.name}: bun pm pack produced no tarball`);
			const { manifest } = await readTarball(join(dest, tgz));
			const left = workspaceRanges(manifest);
			if (left.length > 0) {
				throw new Error(
					`${pkg.name}: the packed manifest keeps a workspace: range (${left.join(', ')})`,
				);
			}
			if (dryRun) {
				console.log(
					`  dry-run   ${pkg.name}@${pkg.version} packed, no workspace: range`,
				);
				continue;
			}
			const provenance = process.env.GITHUB_ACTIONS ? ['--provenance'] : [];
			const result =
				await $`npm publish ${join(dest, tgz)} --access public ${provenance}`
					.quiet()
					.nothrow();
			process.stdout.write(result.stdout);
			process.stderr.write(result.stderr);
			if (result.exitCode !== 0) {
				if (isAlreadyPublishedError(result.stderr.toString())) {
					console.log(
						`  skipped   ${pkg.name}@${pkg.version} already published (staged on npm)`,
					);
					continue;
				}
				throw new Error(
					`${pkg.name}: npm publish failed (exit ${result.exitCode})`,
				);
			}
			published++;
			console.log(`  published ${pkg.name}@${pkg.version}`);
		}
	} finally {
		await rm(workdir, { recursive: true, force: true });
	}
	console.log(`\n${dryRun ? 'dry run: ' : ''}${published} published.`);
}

if (import.meta.main) await main();
