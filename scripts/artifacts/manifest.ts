import { onRegistry } from './registry';
import { type SiblingManifest, siblingRangeProblems } from './siblings';
import { type Tarball, tarballProblems } from './tarball';

/**
 * What a published tarball may not contain, measured on Bun 1.4.0 rather than
 * assumed:
 *
 *   - a `link:`, `file:` or `workspace:` in a field a consumer installs.
 *     `devDependencies` are exempt: a consumer never installs a dependency's
 *     dev dependencies, so a `link:` there is untidy, not harmful. A
 *     `workspace:` left in a tarball means `bun pm pack` did not resolve it,
 *     and no registry can.
 *   - a **required** peer that is on no registry. This is the shape that once
 *     broke every consumer's install of nxgt-core with a 404. An *optional*
 *     peer is safe whatever its range; a required one is not.
 *   - a **sibling range other than the one its `workspace:` spec produces**
 *     beside the sibling's version in this workspace, which is what a stale
 *     `bun.lock` publishes; `siblings.ts` holds that check and why it is
 *     exact.
 *   - an **exact pin on a sibling package**. `workspace:*` publishes as the
 *     exact version, so a package would demand the exact
 *     sibling it was built with while the consumer's own caret range
 *     resolved to a newer one: two copies in one tree, and two
 *     `ValidationError` classes. `workspace:^` publishes
 *     as a caret range, which dedupes.
 *   - a **package that lists itself** in a field a consumer installs. None of
 *     the checks above see it: `@nxgt/material` shipped `"@nxgt/material": "."`
 *     for four months, and `.` is neither a `file:` prefix nor a digit. It is
 *     not inert — `.` resolves to the *consumer's* directory, so every install
 *     grew a second copy of the package reporting the consumer's own version,
 *     plus a `bun.lock` entry no manifest declared and `bun install` kept
 *     re-creating. A package self-references through its `name` and `exports`.
 *   - a **license other than MIT, or no `LICENSE` in the tarball**. npm only
 *     ships the `LICENSE` in the package's own directory, never the root's.
 *   - a **`files` entry the tarball does not hold**. npm skips an entry that
 *     matches nothing, so a `docs` folder renamed or a mistyped entry would
 *     publish without a word.
 *   - **test code**: a `*.spec.*`, a `*.test.*`, a snapshot, or a
 *     `<subject>.fixtures.*` file.
 *   - a **package not published publicly to npmjs**: its `publishConfig`
 *     must be `{ "access": "public" }`; a scoped package on npm's defaults
 *     is refused as restricted.
 */
export async function manifestProblems(
	tarballs: readonly Tarball[],
	sources: readonly SiblingManifest[],
): Promise<string[]> {
	const manifests = tarballs.map((t) => t.manifest);
	const problems = [
		...tarballs.flatMap(tarballProblems),
		...manifestShapeProblems(manifests),
		...siblingRangeProblems(manifests, sources),
		...manifests.flatMap(accessProblems),
	];
	const own = new Set(manifests.map((m) => m.name as string));

	for (const manifest of manifests) {
		const meta =
			(manifest.peerDependenciesMeta as Record<
				string,
				{ optional?: boolean }
			>) ?? {};
		for (const peer of Object.keys(
			(manifest.peerDependencies as Record<string, string>) ?? {},
		)) {
			if (meta[peer]?.optional || own.has(peer)) continue;
			if (!(await onRegistry(peer))) {
				problems.push(
					`${manifest.name}: peerDependencies.${peer} is required but is on no registry`,
				);
			}
		}
	}

	return problems;
}

/**
 * A package that does not publish publicly to npmjs: `publishConfig` must
 * be `{ "access": "public" }` (a `registry` is accepted only when it is
 * npmjs). `changeset publish` reads the manifest, and a scoped package left on
 * npm's defaults would be refused as restricted.
 */
export function accessProblems(manifest: Record<string, unknown>): string[] {
	const name = manifest.name as string;
	const config = manifest.publishConfig as Record<string, unknown> | undefined;
	const registry = config?.registry;
	return config?.access === 'public' &&
		(registry === undefined || registry === 'https://registry.npmjs.org')
		? []
		: [
				`${name}: publishConfig must be { access: "public" } (npmjs); ` +
					'graxia is open source',
			];
}

/**
 * Every check on the manifests' dependency fields that needs no network nor
 * the workspace: a `link:`, `file:` or `workspace:`, a package listing
 * itself, and an exact pin on a sibling. Pure, so it has specs.
 */
export function manifestShapeProblems(
	manifests: readonly Record<string, unknown>[],
): string[] {
	const own = new Set(manifests.map((m) => m.name as string));
	return manifests.flatMap((manifest) =>
		['dependencies', 'peerDependencies', 'optionalDependencies'].flatMap(
			(field) =>
				Object.entries<string>(
					(manifest[field] as Record<string, string>) ?? {},
				).flatMap(([dep, range]) =>
					dependencyProblems(
						manifest.name as string,
						field,
						dep,
						String(range),
						own,
					),
				),
		),
	);
}

function dependencyProblems(
	name: string,
	field: string,
	dep: string,
	range: string,
	own: ReadonlySet<string>,
): string[] {
	const problems: string[] = [];
	if (/^(link|file):/.test(range)) {
		problems.push(`${name}: ${field}.${dep} = ${range}`);
	}
	if (range.startsWith('workspace:')) {
		problems.push(
			`${name}: ${field}.${dep} = ${range}, which \`bun pm pack\` should ` +
				'have resolved',
		);
	}
	if (dep === name) {
		problems.push(
			`${name}: ${field} lists itself as ${range}; a relative path ` +
				"there resolves to the CONSUMER's directory — " +
				'`exports` already makes the package self-referencing',
		);
	}
	if (own.has(dep) && /^\d/.test(range)) {
		problems.push(
			`${name}: ${field}.${dep} = ${range} pins a sibling exactly; ` +
				'use `workspace:^` so the consumer gets one copy',
		);
	}
	return problems;
}
