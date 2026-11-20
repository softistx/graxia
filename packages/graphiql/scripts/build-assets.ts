/**
 * Bundles the GraphiQL client (`src/client/main.tsx`) and the Apollo Sandbox bootstrap (`src/client/sandbox.ts`) into `dist/assets/`:
 * hashed script and style, gzip variants and `manifest.json`. Nothing is
 * fetched at run time: the page loads only these files, so a strict CSP holds.
 * Runs after `build.ts`, which prunes what it did not write from `dist/`.
 */
import { mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

const out = 'dist/assets';
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

const result = await Bun.build({
	entrypoints: ['src/client/main.tsx', 'src/client/sandbox.ts'],
	outdir: out,
	target: 'browser',
	format: 'esm',
	minify: true,
	splitting: false,
	sourcemap: 'none',
	naming: '[name]-[hash].[ext]',
	define: { 'process.env.NODE_ENV': '"production"' },
});
if (!result.success) {
	for (const log of result.logs) console.error(log);
	process.exit(1);
}

const files: Record<string, { type: 'script' | 'style'; size: number }> = {};
let script = '';
let sandbox = '';
let style = '';
for (const name of await readdir(out)) {
	const type = name.endsWith('.js')
		? 'script'
		: name.endsWith('.css')
			? 'style'
			: undefined;
	if (type === undefined) {
		console.error(`graphiql assets: unexpected output ${name}`);
		process.exit(1);
	}
	const bytes = new Uint8Array(await Bun.file(join(out, name)).arrayBuffer());
	await Bun.write(join(out, `${name}.gz`), Bun.gzipSync(bytes));
	files[name] = { type, size: bytes.byteLength };
	if (type === 'script' && name.startsWith('sandbox-')) sandbox = name;
	else if (type === 'script') script = name;
	else style = name;
}
if (script === '' || style === '' || sandbox === '') {
	console.error(
		'graphiql assets: the bundle needs the GraphiQL script and style and the Sandbox script',
	);
	process.exit(1);
}
await Bun.write(
	join(out, 'manifest.json'),
	`${JSON.stringify({ script, style, sandbox, files }, null, '\t')}\n`,
);
const total = Object.values(files).reduce((sum, f) => sum + f.size, 0);
console.log(
	`@softistx/graxia-graphiql: ${script} + ${style} + ${sandbox}, ${(total / 1e6).toFixed(2)} MB raw`,
);
