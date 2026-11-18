import { isRecord } from '../http/record';
import type { RequestState } from '../plugins/state';
import type { GraphQLParams } from '../plugins/types';
import { manifestKeys, sha256Hex, storeKey } from './apq';
import type { ResolvedTrusted } from './options';

/** Why a request is refused before it is parsed. */
export interface TrustedRefusal {
	ok: false;
	message: string;
	code: string;
	/** An HTTP status; absent means the media type's rule for a pre-execution error. */
	status?: number;
	fix?: string;
}

/** The parameters to run (the query filled in from the manifest or the store), or a refusal. */
export type Resolution =
	| {
			ok: true;
			params: GraphQLParams;
			/** Stores a query the client sent in full; call it once the document parsed and validated. */
			register?: () => Promise<void>;
	  }
	| TrustedRefusal;

/** @internal Resolves `documentId`, `extractKey` and automatic persisted queries into a query. */
export interface TrustedDocuments {
	resolve(
		params: GraphQLParams,
		request: Request | undefined,
		state: RequestState,
	): Promise<Resolution>;
}

type Key = { id: string } | { hash: string } | TrustedRefusal;

const refuse = (
	message: string,
	code: string,
	status?: number,
	fix?: string,
): TrustedRefusal => ({
	ok: false,
	message,
	code,
	...(status !== undefined ? { status } : {}),
	...(fix !== undefined ? { fix } : {}),
});

const hasQuery = (params: GraphQLParams) =>
	typeof params.query === 'string' && params.query !== '';

function keyOf(
	params: GraphQLParams,
	request: Request | undefined,
	rt: ResolvedTrusted,
): Key | undefined {
	const custom = rt.extractKey?.(params, request);
	if (typeof custom === 'string' && custom !== '') return { id: custom };
	if (params.documentId !== undefined) return { id: params.documentId };
	const ext = params.extensions?.['persistedQuery'];
	if (ext === undefined) return undefined;
	if (!isRecord(ext) || typeof ext['sha256Hash'] !== 'string')
		return refuse(
			'The "persistedQuery" extension must be { version: 1, sha256Hash: string }.',
			'BAD_USER_INPUT',
			400,
		);
	if (ext['version'] !== 1)
		return refuse(
			'Unsupported persisted query version',
			'PERSISTED_QUERY_VERSION_NOT_SUPPORTED',
		);
	return { hash: ext['sha256Hash'].toLowerCase() };
}

/** @internal Builds the trusted documents step of the request pipeline. */
export function createTrustedDocuments(
	rt: ResolvedTrusted,
	report: (error: unknown, state: RequestState) => void,
): TrustedDocuments {
	const lookup = async (
		id: string,
		state: RequestState,
	): Promise<string | undefined> => {
		for (const key of manifestKeys(id)) {
			const source = rt.manifest.get(key);
			if (source !== undefined) return source;
		}
		try {
			return await rt.store?.get(storeKey(id));
		} catch (error) {
			// A store outage is not the client's fault: report it, answer "not found".
			report(error, state);
			return undefined;
		}
	};
	const byId = async (
		id: string,
		params: GraphQLParams,
		state: RequestState,
	): Promise<Resolution> => {
		if (hasQuery(params))
			return refuse(
				'Send either documentId or query, not both.',
				'BAD_USER_INPUT',
				400,
			);
		const source = await lookup(id, state);
		return source === undefined
			? refuse(
					`Persisted document ${id.slice(0, 100)} not found.`,
					'PERSISTED_QUERY_NOT_FOUND',
					400,
				)
			: { ok: true, params: { ...params, query: source } };
	};
	const byHash = async (
		hash: string,
		params: GraphQLParams,
		state: RequestState,
	): Promise<Resolution> => {
		const sent = hasQuery(params) ? (params.query as string) : undefined;
		if (sent !== undefined && sha256Hex(sent) !== hash)
			return refuse(
				'provided sha does not match query',
				'PROVIDED_SHA_DOESNT_MATCH',
			);
		const source = await lookup(hash, state);
		if (source !== undefined)
			return { ok: true, params: { ...params, query: source } };
		if (!rt.apq || !rt.store)
			return refuse(
				'PersistedQueryNotSupported',
				'PERSISTED_QUERY_NOT_SUPPORTED',
			);
		if (sent === undefined)
			return refuse('PersistedQueryNotFound', 'PERSISTED_QUERY_NOT_FOUND');
		const { store } = rt;
		return {
			ok: true,
			params,
			register: async () => {
				try {
					await store.set(storeKey(hash), sent);
				} catch (error) {
					report(error, state);
				}
			},
		};
	};
	return {
		async resolve(params, request, state) {
			const key = keyOf(params, request, rt);
			if (key === undefined)
				return rt.mode === 'strict' && hasQuery(params)
					? refuse(
							'Only persisted documents are allowed.',
							'PERSISTED_QUERY_ONLY',
							400,
							'Send a documentId (or a persisted query hash) from the trusted manifest, or set trustedDocuments.mode to "mixed".',
						)
					: { ok: true, params };
			if ('ok' in key) return key;
			return 'id' in key
				? byId(key.id, params, state)
				: byHash(key.hash, params, state);
		},
	};
}
