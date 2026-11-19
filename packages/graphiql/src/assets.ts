import { GraxiaConfigError } from '@graxia/core';

export interface Manifest {
	script: string;
	style: string;
	/** The Apollo Sandbox bootstrap script. */
	sandbox: string;
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
			manifest ??= loadManifest(base).catch((error: unknown) => {
				manifest = undefined; // a failed load is retried, never cached
				throw error;
			});
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

async function loadManifest(base: URL): Promise<Manifest> {
	const url = new URL('manifest.json', base);
	try {
		return (await Bun.file(url).json()) as Manifest;
	} catch (cause) {
		throw new GraxiaConfigError(
			`GraphiQL assets not found at ${url.href}: the installed @graxia/graphiql has no dist/assets: reinstall it; in the graxia repository, run \`bun run build\``,
			{ cause },
		);
	}
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
	const wantsGzip = acceptsGzip(acceptEncoding);
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

/** Whether `Accept-Encoding` allows gzip: listed (or `*`) with a q-value above 0. */
function acceptsGzip(header: string | null): boolean {
	let allowed: boolean | undefined;
	for (const part of (header ?? '').split(',')) {
		const [coding = '', ...params] = part.trim().toLowerCase().split(';');
		if (coding.trim() !== 'gzip' && coding.trim() !== '*') continue;
		const q = params
			.map((p) => /^\s*q\s*=\s*([\d.]+)\s*$/.exec(p)?.[1])
			.find((v) => v !== undefined);
		const ok = q === undefined || Number(q) > 0;
		if (coding.trim() === 'gzip') return ok;
		allowed = ok;
	}
	return allowed ?? false;
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
