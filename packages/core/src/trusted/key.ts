import { isRecord } from '../http/record';
import type { GraphQLParams } from '../plugins/types';
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

/** Where a request names its document: an opaque id, or the hash of an APQ. */
export type Key = { id: string } | { hash: string } | TrustedRefusal;

export const refuse = (
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

export const hasQuery = (params: GraphQLParams) =>
	typeof params.query === 'string' && params.query !== '';

/**
 * The key a request names its document by: `extractKey`, then `documentId`, then
 * the APQ extension. `undefined` when it names none; a refusal when the APQ
 * extension is malformed or of another version.
 */
export function keyOf(
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
