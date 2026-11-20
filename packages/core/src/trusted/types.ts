import type { KeyValueCache } from '../cache/types';
import type { GraphQLParams } from '../plugins/types';

/**
 * The Apollo persisted query manifest (`generate-persisted-query-manifest`):
 * `format` is `'apollo-persisted-query-manifest'` and `version` is `1`. They
 * are typed `string` and `number` so that a manifest imported from JSON
 * (`import manifest from './manifest.json'`) type-checks; the values are
 * checked when the manifest is read.
 */
export interface ApolloPersistedQueryManifest {
	format: string;
	version: number;
	operations: readonly {
		id: string;
		body: string;
		name?: string;
		type?: string;
	}[];
}

/**
 * The trusted documents of an application, in any of the supported formats:
 * `{ [id]: source }` (Relay `persisted-queries.json`, graphql-codegen
 * `persisted-documents.json`, or your own), an Apollo persisted query
 * manifest, or a `Map` from id to source.
 */
export type TrustedManifest =
	| Readonly<Record<string, string>>
	| ReadonlyMap<string, string>
	| ApolloPersistedQueryManifest;

/** The `trustedDocuments` option of `createGraxia`. */
export interface TrustedDocumentsOptions {
	/** The documents the server trusts, by id. */
	manifest?: TrustedManifest;
	/**
	 * Where automatic persisted queries are registered and read: any
	 * `KeyValueCache<string>` (`redisCache()` from `@softistx/graxia-redis` shares them across
	 * processes). An in-memory cache of 1 000 entries when `apq` is on and none is given.
	 * With `strict` it is read only (something else fills it).
	 */
	store?: KeyValueCache<string>;
	/**
	 * Automatic persisted queries (the Apollo protocol): a client sends a hash, and the
	 * query once the server asks. `true` in `mixed` mode, always off in `strict`.
	 */
	apq?: boolean;
	/**
	 * `strict` runs only persisted documents (a manifest entry or a store hit) and refuses
	 * any other query; `mixed` also runs queries sent in full. `strict` when `NODE_ENV` is
	 * `production`, else `mixed`.
	 */
	mode?: 'strict' | 'mixed';
	/** Takes the document id from your own place (a header, a path), before `documentId` and the APQ extension. */
	extractKey?: (
		params: GraphQLParams,
		request: Request | undefined,
	) => string | undefined;
}
