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
 * so a re-run is safe; `changeset tag` runs last and tags what is released.
 *
 * `--dry-run` packs and asserts, publishes nothing and tags nothing.
 * Credentials: `NODE_AUTH_TOKEN` (set by `publish.yml`); provenance is on when
 * the workflow has `id-token: write` (`GITHUB_ACTIONS`).
 */
import { mkdtemp, rm } from 'node:fs/promises';
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
	const workdir = await mkdtemp(join(tmpdir(), 'graxia-publish-'));
	let published = 0;
	try {
		for (const pkg of await publishable()) {
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
			await $`npm publish ${join(dest, tgz)} --access public ${provenance}`;
			published++;
			console.log(`  published ${pkg.name}@${pkg.version}`);
		}
		if (!dryRun && published > 0) await $`bunx changeset tag`.cwd(ROOT);
	} finally {
		await rm(workdir, { recursive: true, force: true });
	}
	console.log(`\n${dryRun ? 'dry run: ' : ''}${published} published.`);
}

if (import.meta.main) await main();
