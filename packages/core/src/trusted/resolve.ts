import type { RequestState } from '../plugins/state';
import type { GraphQLParams } from '../plugins/types';
import { manifestKeys, sha256Hex, storeKey } from './apq';
import { hasQuery, keyOf, refuse, type TrustedRefusal } from './key';
import type { ResolvedTrusted } from './options';

export type { TrustedRefusal };

/** The parameters to run (the query filled in from the manifest or the store), or a refusal. */
export type Resolution =
	| {
			ok: true;
			params: GraphQLParams;
			/**
			 * Stores a query the client sent in full, in the background; call it once the
			 * document parsed and validated, and only if the query was not rewritten.
			 */
			register?: () => void;
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

type Report = (error: unknown, state: RequestState) => void;
interface Env {
	rt: ResolvedTrusted;
	report: Report;
	state: RequestState;
}

async function lookup(env: Env, id: string): Promise<string | undefined> {
	for (const key of manifestKeys(id)) {
		const source = env.rt.manifest.get(key);
		if (source !== undefined) return source;
	}
	try {
		return await env.rt.store?.get(storeKey(id));
	} catch (error) {
		// A store outage is not the client's fault: report it, answer "not found".
		env.report(error, env.state);
		return undefined;
	}
}

async function byId(
	env: Env,
	id: string,
	params: GraphQLParams,
): Promise<Resolution> {
	if (hasQuery(params))
		return refuse(
			'Send either documentId or query, not both.',
			'BAD_USER_INPUT',
			400,
		);
	const source = await lookup(env, id);
	return source === undefined
		? refuse(
				`Persisted document ${id.slice(0, 100)} not found.`,
				'PERSISTED_QUERY_NOT_FOUND',
				400,
			)
		: { ok: true, params: { ...params, query: source } };
}

async function byHash(
	env: Env,
	hash: string,
	params: GraphQLParams,
): Promise<Resolution> {
	const { rt, report, state } = env;
	const sent = hasQuery(params) ? (params.query as string) : undefined;
	if (sent !== undefined && sha256Hex(sent) !== hash)
		return refuse(
			'provided sha does not match query',
			'PROVIDED_SHA_DOESNT_MATCH',
		);
	const source = await lookup(env, hash);
	if (source !== undefined)
		return { ok: true, params: { ...params, query: source } };
	const { store } = rt;
	if (!rt.apq || !store)
		return refuse(
			'PersistedQueryNotSupported',
			'PERSISTED_QUERY_NOT_SUPPORTED',
		);
	if (sent === undefined)
		return refuse('PersistedQueryNotFound', 'PERSISTED_QUERY_NOT_FOUND');
	return {
		ok: true,
		params,
		// In the background: the request never waits for the store to accept it.
		register: () => {
			Promise.resolve()
				.then(() => store.set(storeKey(hash), sent))
				.catch((error: unknown) => report(error, state));
		},
	};
}

const STRICT_FIX =
	'Send a documentId (or a persisted query hash) from the trusted manifest, or set trustedDocuments.mode to "mixed".';

/** @internal Builds the trusted documents step of the request pipeline. */
export function createTrustedDocuments(
	rt: ResolvedTrusted,
	report: Report,
): TrustedDocuments {
	return {
		async resolve(params, request, state) {
			const key = keyOf(params, request, rt);
			const env: Env = { rt, report, state };
			if (key === undefined)
				return rt.mode === 'strict' && hasQuery(params)
					? refuse(
							'Only persisted documents are allowed.',
							'PERSISTED_QUERY_ONLY',
							400,
							STRICT_FIX,
						)
					: { ok: true, params };
			if ('ok' in key) return key;
			return 'id' in key
				? byId(env, key.id, params)
				: byHash(env, key.hash, params);
		},
	};
}
