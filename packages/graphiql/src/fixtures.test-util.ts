import { createGraxia, createSchema, type GraxiaPlugin } from '@graxia/core';
import type { AssetSource, Manifest } from './assets';

export const manifest: Manifest = {
	script: 'main-abc.js',
	style: 'main-abc.css',
	sandbox: 'sandbox-abc.js',
	files: {
		'main-abc.js': { type: 'script', size: 12 },
		'main-abc.css': { type: 'style', size: 8 },
		'sandbox-abc.js': { type: 'script', size: 9 },
	},
};

const texts: Record<string, string> = {
	'main-abc.js': 'console.log(1)',
	'main-abc.css': 'body{}',
	'sandbox-abc.js': 'sandbox()',
};

/** In-memory assets: `x` and `x.gz` hold different bytes so tests tell them apart. */
export const fakeAssets: AssetSource = {
	manifest: async () => manifest,
	async read(name, gzip) {
		const text = texts[name];
		return text === undefined
			? undefined
			: new TextEncoder().encode(gzip ? `GZ:${text}` : text);
	},
};

export function host(
	plugin: GraxiaPlugin,
	options: Record<string, unknown> = {},
) {
	return createGraxia({
		schema: createSchema()({
			typeDefs: 'type Query { hello: String }',
			resolvers: { Query: { hello: () => 'world' } },
		}),
		plugins: [plugin],
		...options,
	});
}

export const browser = (query = '', headers: HeadersInit = {}) =>
	new Request(`http://localhost/graphql${query}`, {
		headers: { accept: 'text/html,application/xhtml+xml', ...headers },
	});
