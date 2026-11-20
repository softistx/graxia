import { describe, expect, test } from 'bun:test';
import { GraxiaConfigError } from '@softistx/graxia';
import { bundledAssets } from './assets';
import { browser, fakeAssets, host } from './fixtures.test-util';
import { createGraphiQL } from './graphiql';

async function config(
	options: Record<string, unknown> = {},
	subscriptions?: { sse?: boolean; ws?: boolean },
) {
	const app = host(
		createGraphiQL({ enabled: true, ...options }, fakeAssets),
		subscriptions ? { subscriptions } : {},
	);
	const html = await (await app.fetch(browser())).text();
	const raw = /data-config="([^"]*)"/.exec(html)?.[1] ?? '{}';
	return JSON.parse(raw.replace(/&quot;/g, '"')).subscriptions;
}

describe('subscriptions are detected from the instance', () => {
	test('ws when the WebSocket is on (the core default)', async () => {
		expect(await config()).toBe('ws');
	});

	test('sse when only SSE is on', async () => {
		expect(await config({}, { ws: false })).toBe('sse');
	});

	test('false when neither is on', async () => {
		expect(await config({}, { ws: false, sse: false })).toBe(false);
	});

	test('an explicit option wins', async () => {
		expect(await config({ subscriptions: 'sse' })).toBe('sse');
		expect(await config({ subscriptions: false })).toBe(false);
	});
});

describe('missing build', () => {
	test('names the URL and the fix, and is not cached', async () => {
		const source = bundledAssets(new URL('file:///graphiql-missing/assets/'));
		const first = source.manifest();
		const error = await first.catch((e: unknown) => e);
		expect(error).toBeInstanceOf(GraxiaConfigError);
		expect((error as Error).message).toBe(
			'GraphiQL assets not found at file:///graphiql-missing/assets/manifest.json: the installed @softistx/graxia-graphiql has no dist/assets: reinstall it; in the graxia repository, run `bun run build`',
		);
		const again = source.manifest();
		expect(again).not.toBe(first);
		await again.catch(() => {});
	});
});

describe('accept-encoding q-values', () => {
	const body = async (encoding: string) => {
		const app = host(createGraphiQL({ enabled: true }, fakeAssets));
		const response = await app.fetch(
			new Request('http://localhost/graphql?graphiql-asset=main-abc.js', {
				headers: { 'accept-encoding': encoding },
			}),
		);
		return response.text();
	};

	test.each(['gzip;q=0', 'gzip; q=0.0, br', '*;q=0', 'br'])(
		'%p is not gzip',
		async (encoding) => {
			expect(await body(encoding)).toBe('console.log(1)');
		},
	);

	test.each(['gzip;q=0.5', 'br, gzip', '*'])('%p is gzip', async (encoding) => {
		expect((await body(encoding)).startsWith('GZ:')).toBe(true);
	});
});
