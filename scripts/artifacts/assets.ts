import { join } from 'node:path';
import { $ } from 'bun';
import type { Pkg } from './packages';

const PROBE = `
import { createGraxia, createSchema } from '@softistx/graxia';
import { graphiql } from '@softistx/graxia-graphiql';

const graxia = createGraxia({
	schema: createSchema()({
		typeDefs: 'type Query { hello: String }',
		resolvers: { Query: { hello: () => 'world' } },
	}),
	plugins: [graphiql({ enabled: true })],
});
const get = (url, headers = {}) => graxia.fetch(new Request(url, { headers }));
const fail = (message) => { console.error('  FAIL    ' + message); process.exit(1); };

const page = await get('http://localhost/graphql', { accept: 'text/html' });
if (page.status !== 200 || !page.headers.get('content-type')?.startsWith('text/html')) {
	fail('page: ' + page.status + ' ' + page.headers.get('content-type'));
}
const html = await page.text();
for (const [pattern, type] of [
	[/<script[^>]* src="([^"]+)"/, 'text/javascript'],
	[/<link[^>]* href="([^"]+)"/, 'text/css'],
]) {
	const match = html.match(pattern);
	if (!match) fail('page names no asset for ' + type);
	const url = new URL(match[1].replaceAll('&amp;', '&'), 'http://localhost/graphql');
	const res = await get(url);
	const got = res.headers.get('content-type') ?? '';
	if (res.status !== 200 || !got.startsWith(type) || (await res.arrayBuffer()).byteLength < 1000) {
		fail(url.search + ': ' + res.status + ' ' + got);
	}
	console.log('  ok      ' + url.search + ' ' + got);
}
`;

/**
 * A package that ships bundled assets (`@softistx/graxia-graphiql`) is imported from the
 * install and asked, through a real instance, for its page, script and style:
 * a tarball that lost `dist/assets` loads fine and 404s here.
 */
export async function assetsServe(
	workdir: string,
	packages: readonly Pkg[],
): Promise<boolean> {
	if (!packages.some((p) => p.name === '@softistx/graxia-graphiql'))
		return true;
	console.log('\nServing the GraphiQL page and its assets from the install…\n');
	await Bun.write(join(workdir, 'assets-probe.mjs'), PROBE);
	const ran = await $`bun run assets-probe.mjs`.cwd(workdir).nothrow();
	if (ran.exitCode === 0) return true;
	console.error(
		'\nThe installed @softistx/graxia-graphiql did not serve its page and assets.\n' +
			'Check that `files` ships dist/assets and that build-assets.ts ran.',
	);
	return false;
}
