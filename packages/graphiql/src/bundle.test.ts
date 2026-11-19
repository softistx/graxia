import { describe, expect, test } from 'bun:test';
import { readdirSync } from 'node:fs';
import { bundledAssets } from './assets';
import { browser, host } from './fixtures.test-util';
import { createGraphiQL } from './index';

const dir = new URL('../dist/assets/', import.meta.url);
const built = await Bun.file(new URL('manifest.json', dir)).exists();

// Needs `bun run build` first (the repository's green bar builds before it tests).
describe.skipIf(!built)('built bundle', () => {
	const app = host(createGraphiQL({ enabled: true }, bundledAssets(dir)));

	test('the page, its script and its style are served from dist/assets', async () => {
		const page = await app.fetch(browser());
		expect(page.status).toBe(200);
		const html = await page.text();
		for (const [pattern, type] of [
			[/src="(\?graphiql-asset=[^"]+)"/, 'text/javascript'],
			[/href="(\?graphiql-asset=[^"]+)"/, 'text/css'],
		] as const) {
			const href = pattern.exec(html)?.[1] ?? '';
			const asset = await app.fetch(
				new Request(`http://localhost/graphql${href}`),
			);
			expect(asset.status).toBe(200);
			expect(asset.headers.get('content-type')).toContain(type);
		}
	});

	test('no loaded external URL in the bundle', async () => {
		const loads = [
			/\bsrc=["']?https?:/,
			/url\(\s*["']?https?:/,
			/import\(\s*["']https?:/,
			/\bfetch\(\s*["']https?:/,
			/@import\s+(?:url\()?["']?https?:/,
			/\bhref=["']?https?:/,
		];
		for (const name of readdirSync(dir)) {
			if (!/\.(js|css)$/.test(name)) continue;
			const text = await Bun.file(new URL(name, dir)).text();
			for (const pattern of loads)
				expect(`${name} ${pattern}: ${pattern.test(text)}`).toContain(
					': false',
				);
		}
	});
});
