export interface Manifest {
	script: string;
	style: string;
	files: Record<string, { type: 'script' | 'style'; size: number }>;
}

/** Where the built assets are read from; replaceable in tests. */
export interface AssetSource {
	manifest(): Promise<Manifest>;
	read(name: string, gzip: boolean): Promise<Uint8Array | undefined>;
}

/** The assets next to this module: `dist/assets/`, read lazily and cached. */
export function bundledAssets(
	base = new URL('./assets/', import.meta.url),
): AssetSource {
	let manifest: Promise<Manifest> | undefined;
	return {
		manifest: () => {
			manifest ??= Bun.file(new URL('manifest.json', base)).json();
			return manifest;
		},
		async read(name, gzip) {
			const file = Bun.file(new URL(gzip ? `${name}.gz` : name, base));
			return (await file.exists())
				? new Uint8Array(await file.arrayBuffer())
				: undefined;
		},
	};
}

const TYPES = {
	script: 'text/javascript; charset=utf-8',
	style: 'text/css; charset=utf-8',
} as const;

/** The response for `?graphiql-asset=<name>`: only names the manifest lists. */
export async function assetResponse(
	source: AssetSource,
	name: string,
	acceptEncoding: string | null,
): Promise<Response> {
	const manifest = await source.manifest();
	const entry = Object.hasOwn(manifest.files, name)
		? manifest.files[name]
		: undefined;
	if (!entry) return notFound();
	const wantsGzip = /\bgzip\b/.test(acceptEncoding ?? '');
	const zipped = wantsGzip ? await source.read(name, true) : undefined;
	const body = zipped ?? (await source.read(name, false));
	if (!body) return notFound();
	return new Response(body as BodyInit, {
		headers: {
			'content-type': TYPES[entry.type],
			'cache-control': 'public, max-age=31536000, immutable',
			'x-content-type-options': 'nosniff',
			vary: 'accept-encoding',
			...(zipped !== undefined ? { 'content-encoding': 'gzip' } : {}),
		},
	});
}

function notFound(): Response {
	return new Response('Not found', {
		status: 404,
		headers: {
			'content-type': 'text/plain; charset=utf-8',
			'x-content-type-options': 'nosniff',
		},
	});
}
