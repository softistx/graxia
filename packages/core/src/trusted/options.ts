import { createMemoryCache } from '../cache/memory';
import type { KeyValueCache } from '../cache/types';
import { GraxiaConfigError } from '../errors/config-error';
import { isRecord } from '../http/record';
import { normalizeManifest } from './manifest';
import type { TrustedDocumentsOptions } from './types';

/** @internal {@link TrustedDocumentsOptions} with defaults applied. */
export interface ResolvedTrusted {
	mode: 'strict' | 'mixed';
	/** Whether a client may register a document (never in `strict`). */
	apq: boolean;
	manifest: ReadonlyMap<string, string>;
	store: KeyValueCache<string> | undefined;
	extractKey: TrustedDocumentsOptions['extractKey'];
}

const isStore = (value: unknown): value is KeyValueCache<string> =>
	isRecord(value) &&
	typeof value['get'] === 'function' &&
	typeof value['set'] === 'function';

/**
 * Applies the defaults of `trustedDocuments`; `undefined` when it is absent
 * (no trusted documents, no persisted queries). `mode` follows `NODE_ENV`
 * (`strict` when it is `production`), read once here.
 * @throws {GraxiaConfigError} on an invalid value.
 */
export function resolveTrusted(options: unknown): ResolvedTrusted | undefined {
	if (options === undefined) return undefined;
	if (!isRecord(options))
		throw new GraxiaConfigError(
			'trustedDocuments must be an object ({ manifest, store, apq, mode, extractKey })',
		);
	const { manifest, store, apq, mode, extractKey } =
		options as TrustedDocumentsOptions;
	const resolvedMode =
		mode ?? (process.env['NODE_ENV'] === 'production' ? 'strict' : 'mixed');
	if (resolvedMode !== 'strict' && resolvedMode !== 'mixed')
		throw new GraxiaConfigError(
			'trustedDocuments.mode must be "strict" or "mixed"',
		);
	if (apq !== undefined && typeof apq !== 'boolean')
		throw new GraxiaConfigError('trustedDocuments.apq must be a boolean');
	if (store !== undefined && !isStore(store))
		throw new GraxiaConfigError(
			'trustedDocuments.store must be a KeyValueCache (get, set and delete)',
		);
	if (extractKey !== undefined && typeof extractKey !== 'function')
		throw new GraxiaConfigError(
			'trustedDocuments.extractKey must be a function (params, request) => string | undefined',
		);
	if (
		resolvedMode === 'strict' &&
		manifest === undefined &&
		!(extractKey && store)
	)
		throw new GraxiaConfigError(
			'trustedDocuments.mode "strict" needs a manifest, or extractKey with a store: no document could ever run',
		);
	const registering = resolvedMode === 'mixed' && (apq ?? true);
	return {
		mode: resolvedMode,
		apq: registering,
		manifest: manifest === undefined ? new Map() : normalizeManifest(manifest),
		store:
			store ??
			(registering ? createMemoryCache({ maxEntries: 1000 }) : undefined),
		extractKey,
	};
}
