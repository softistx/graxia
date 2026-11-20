import { describe, expect, test } from 'bun:test';
import {
	MOVED,
	type Npm,
	plan,
	run,
	waitForPublished,
	waitFromEnv,
} from './deprecate-moved';

function fake(
	published: Record<string, string>,
	deprecated: Record<string, (string | undefined)[]>,
): Npm & { calls: string[] } {
	const calls: string[] = [];
	return {
		calls,
		latestVersion: async (n) => published[n] ?? null,
		deprecations: async (n) => deprecated[n] ?? [],
		deprecate: async (n, m) => {
			calls.push(`${n} ${m}`);
		},
	};
}

describe('deprecate-moved', () => {
	test('maps core to @softistx/graxia and the rest to @softistx/graxia-<x>', () => {
		expect(Object.fromEntries(MOVED)).toEqual({
			'@graxia/core': '@softistx/graxia',
			'@graxia/envelop': '@softistx/graxia-envelop',
			'@graxia/graphiql': '@softistx/graxia-graphiql',
			'@graxia/mcp': '@softistx/graxia-mcp',
			'@graxia/redis': '@softistx/graxia-redis',
		});
	});

	test('skips every pair while the new names are not on npm', async () => {
		const npm = fake({}, { '@graxia/core': [undefined] });
		const out = await run(npm, false, () => {});
		expect(out.every((o) => o.action === 'skip-new-not-published')).toBe(true);
		expect(npm.calls).toEqual([]);
	});

	test('deprecates when the new name is published and a version is not marked', async () => {
		const npm = fake(
			{ '@softistx/graxia': '0.15.0' },
			{ '@graxia/core': ['moved to @softistx/graxia', undefined] },
		);
		await run(npm, false, () => {});
		expect(npm.calls).toEqual(['@graxia/core moved to @softistx/graxia']);
	});

	test('skips a name whose versions all carry the message (idempotent)', async () => {
		const npm = fake(
			{ '@softistx/graxia-mcp': '0.2.0' },
			{
				'@graxia/mcp': [
					'moved to @softistx/graxia-mcp',
					'moved to @softistx/graxia-mcp',
				],
			},
		);
		const out = await plan(npm);
		expect(out.find((o) => o.old === '@graxia/mcp')?.action).toBe(
			'skip-already-deprecated',
		);
	});

	test('skips an old name that is not on npm', async () => {
		const out = await plan(fake({ '@softistx/graxia-redis': '0.3.0' }, {}));
		expect(out.find((o) => o.old === '@graxia/redis')?.action).toBe(
			'skip-old-not-published',
		);
	});

	test('--dry-run never calls deprecate', async () => {
		const npm = fake(
			{ '@softistx/graxia': '0.15.0' },
			{ '@graxia/core': [undefined] },
		);
		const lines: string[] = [];
		await run(npm, true, (l) => lines.push(l));
		expect(npm.calls).toEqual([]);
		expect(lines.join('\n')).toContain('dry-run');
	});

	test('deprecates a name whose versions carry another message', async () => {
		const npm = fake(
			{ '@softistx/graxia-envelop': '0.2.0' },
			{ '@graxia/envelop': ['other message'] },
		);
		await run(npm, false, () => {});
		expect(npm.calls).toEqual([
			'@graxia/envelop moved to @softistx/graxia-envelop',
		]);
	});

	test('rejects when npm cannot be read, and deprecates nothing', async () => {
		const npm = fake({ '@softistx/graxia': '0.15.0' }, {});
		npm.deprecations = async () => {
			throw new Error('npm answered 500');
		};
		await expect(run(npm, false, () => {})).rejects.toThrow('npm answered 500');
		expect(npm.calls).toEqual([]);
	});

	test('waits for a new name that shows up late, then deprecates', async () => {
		const base = fake({}, { '@graxia/core': [undefined] });
		let checks = 0;
		const npm: Npm = {
			...base,
			latestVersion: async (n) =>
				n === '@softistx/graxia' && ++checks > 2 ? '0.15.0' : null,
		};
		const slept: number[] = [];
		const waiting = waitForPublished(npm, {
			intervalMs: 15_000,
			budgetMs: 300_000,
			sleep: async (ms) => {
				slept.push(ms);
			},
		});
		const out = await run(waiting, false, () => {});
		expect(out.find((o) => o.old === '@graxia/core')?.action).toBe('deprecate');
		expect(base.calls).toEqual(['@graxia/core moved to @softistx/graxia']);
		expect(slept.slice(0, 2)).toEqual([15_000, 15_000]);
	});

	test('skips every pair when the new names never show up, within one shared budget', async () => {
		const base = fake({}, { '@graxia/core': [undefined] });
		let slept = 0;
		const waiting = waitForPublished(base, {
			intervalMs: 15_000,
			budgetMs: 60_000,
			sleep: async (ms) => {
				slept += ms;
			},
		});
		const out = await run(waiting, false, () => {});
		expect(out.every((o) => o.action === 'skip-new-not-published')).toBe(true);
		expect(base.calls).toEqual([]);
		expect(slept).toBe(60_000);
	});

	test('a zero budget checks once without sleeping', async () => {
		const wait = waitFromEnv({ DEPRECATE_WAIT_SECONDS: '0' });
		expect(wait.budgetMs).toBe(0);
		const npm = waitForPublished(fake({}, {}), {
			...wait,
			sleep: async () => {
				throw new Error('must not sleep');
			},
		});
		expect(await npm.latestVersion('@softistx/graxia')).toBeNull();
		expect(waitFromEnv({}).budgetMs).toBe(300_000);
	});
});
