#!/usr/bin/env bun
/**
 * Deprecates the old `@graxia/*` names once their `@softistx/graxia*`
 * replacements are on npm. Run by `publish.yml` after the publish step (the
 * laptop holds no npm token). Idempotent, and it never unpublishes.
 *
 * For each pair: skipped while the new name has no version on npm, skipped when
 * every version of the old name already carries the moved message, otherwise
 * `npm deprecate "<old>@*" "moved to <new>"`. `--dry-run` only prints.
 */
import { $ } from 'bun';

/** Old name to new name. */
export const MOVED: readonly (readonly [old: string, next: string])[] = [
	['@graxia/core', '@softistx/graxia'],
	['@graxia/envelop', '@softistx/graxia-envelop'],
	['@graxia/graphiql', '@softistx/graxia-graphiql'],
	['@graxia/mcp', '@softistx/graxia-mcp'],
	['@graxia/redis', '@softistx/graxia-redis'],
];

export function movedMessage(next: string): string {
	return `moved to ${next}`;
}

export interface Npm {
	/** A published version of the package, or null when it has none. */
	latestVersion(name: string): Promise<string | null>;
	/** The `deprecated` field of every published version (undefined when not deprecated); empty when the package is not on npm. */
	deprecations(name: string): Promise<(string | undefined)[]>;
	deprecate(name: string, message: string): Promise<void>;
}

export type Outcome =
	| { old: string; next: string; action: 'skip-new-not-published' }
	| { old: string; next: string; action: 'skip-old-not-published' }
	| { old: string; next: string; action: 'skip-already-deprecated' }
	| { old: string; next: string; action: 'deprecate'; message: string };

export async function plan(npm: Npm): Promise<Outcome[]> {
	const out: Outcome[] = [];
	for (const [old, next] of MOVED) {
		if ((await npm.latestVersion(next)) === null) {
			out.push({ old, next, action: 'skip-new-not-published' });
			continue;
		}
		const versions = await npm.deprecations(old);
		const message = movedMessage(next);
		if (versions.length === 0) {
			out.push({ old, next, action: 'skip-old-not-published' });
		} else if (versions.every((d) => d?.startsWith(message))) {
			out.push({ old, next, action: 'skip-already-deprecated' });
		} else {
			out.push({ old, next, action: 'deprecate', message });
		}
	}
	return out;
}

export async function run(
	npm: Npm,
	dryRun: boolean,
	log: (line: string) => void = console.log,
): Promise<Outcome[]> {
	const outcomes = await plan(npm);
	for (const o of outcomes) {
		if (o.action !== 'deprecate') {
			log(`  skipped   ${o.old}: ${o.action}`);
		} else if (dryRun) {
			log(`  dry-run   npm deprecate "${o.old}@*" "${o.message}"`);
		} else {
			await npm.deprecate(o.old, o.message);
			log(`  deprecated ${o.old}@* (${o.message})`);
		}
	}
	return outcomes;
}

export interface Wait {
	/** Pause between two checks of a new name. */
	intervalMs: number;
	/** Total time spent waiting, shared by every pair. 0 checks once. */
	budgetMs: number;
	sleep?: (ms: number) => Promise<void>;
}

/**
 * Wraps `latestVersion` so an absent name is checked again until it shows up or
 * the shared budget is spent (npm lags a minute or so after a publish). The
 * decision in `plan` is untouched, and a name that never shows up still reads
 * as not published, hence skipped.
 */
export function waitForPublished(npm: Npm, wait: Wait): Npm {
	const sleep = wait.sleep ?? ((ms: number) => Bun.sleep(ms));
	let waited = 0;
	return {
		...npm,
		async latestVersion(name) {
			let version = await npm.latestVersion(name);
			while (
				version === null &&
				wait.intervalMs > 0 &&
				waited + wait.intervalMs <= wait.budgetMs
			) {
				await sleep(wait.intervalMs);
				waited += wait.intervalMs;
				version = await npm.latestVersion(name);
			}
			return version;
		},
	};
}

/** Budget from `DEPRECATE_WAIT_SECONDS` (default 300, 0 disables waiting). */
export function waitFromEnv(env: Record<string, string | undefined>): Wait {
	const raw = Number(env.DEPRECATE_WAIT_SECONDS ?? 300);
	const seconds = Number.isFinite(raw) && raw > 0 ? raw : 0;
	return { intervalMs: 15_000, budgetMs: seconds * 1000 };
}

const registry = (name: string) =>
	`https://registry.npmjs.org/${name.replace('/', '%2F')}`;

export const realNpm: Npm = {
	async latestVersion(name) {
		const out = await $`npm view ${name} version`.quiet().nothrow();
		const version = out.stdout.toString().trim();
		return out.exitCode === 0 && version !== '' ? version : null;
	},
	async deprecations(name) {
		const res = await fetch(registry(name));
		if (res.status === 404) return [];
		if (!res.ok) throw new Error(`${name}: npm answered ${res.status}`);
		const doc = (await res.json()) as {
			versions?: Record<string, { deprecated?: string }>;
		};
		return Object.values(doc.versions ?? {}).map((v) => v.deprecated);
	},
	async deprecate(name, message) {
		await $`npm deprecate ${`${name}@*`} ${message}`;
	},
};

if (import.meta.main) {
	try {
		await run(
			waitForPublished(realNpm, waitFromEnv(process.env)),
			process.argv.includes('--dry-run'),
		);
	} catch (error) {
		console.error(`deprecate-moved failed: ${error}`);
		process.exit(1);
	}
}
