import type { TrustedManifest } from '@softistx/graxia';

/** One document of a manifest. */
export interface ManifestEntry {
	id: string;
	source: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The documents of a manifest in any of core's three formats (a `Map`, an
 * Apollo persisted query manifest, an object of id to source), in order.
 * `undefined` when it is none of them. Sources are not checked here.
 */
export function manifestEntries(
	manifest: TrustedManifest | unknown,
): ManifestEntry[] | undefined {
	if (manifest instanceof Map)
		return [...manifest].map(([id, source]) => ({ id: String(id), source }));
	if (!isRecord(manifest)) return undefined;
	if (manifest['format'] === 'apollo-persisted-query-manifest') {
		const { operations } = manifest;
		if (!Array.isArray(operations)) return undefined;
		return operations.map((operation, index) => ({
			id: isRecord(operation) ? String(operation['id']) : `#${index}`,
			source: isRecord(operation) ? operation['body'] : undefined,
		}));
	}
	return Object.entries(manifest).map(([id, source]) => ({ id, source }));
}
