import type { GraphQLParams } from '../plugins/types';
import { type ParamsResult, paramsFromJson } from './params';

/** Batching option: `false` (off), `true` (on, 10 entries at most, as Yoga) or `{ limit }`. */
export type BatchingOption = boolean | { limit: number };

/** @internal The option once resolved: off, or on with its limit. */
export type ResolvedBatching = false | { limit: number };

/** The most entries `batching: true` accepts (graphql-yoga's default). */
export const DEFAULT_BATCH_LIMIT = 10;

/** The code of a refused batch. */
export type BatchCode =
	| 'BATCHING_DISABLED'
	| 'BATCH_TOO_LARGE'
	| 'BATCH_INVALID';

/** The entries of a batch, or the reason the batch is refused (a 400). */
export type BatchResult =
	| { ok: true; entries: GraphQLParams[] }
	| { ok: false; message: string; code: BatchCode };

/**
 * Validates a JSON array body as a batch. Off, an array is refused; on, it
 * must hold between 1 and `limit` entries, each a valid parameter object.
 */
export function parseBatch(
	body: readonly unknown[],
	batching: ResolvedBatching,
): BatchResult {
	if (batching === false)
		return {
			ok: false,
			message: 'Batching is not enabled on this server.',
			code: 'BATCHING_DISABLED',
		};
	if (body.length === 0)
		return {
			ok: false,
			message: 'A batch must hold at least one operation.',
			code: 'BATCH_INVALID',
		};
	if (body.length > batching.limit)
		return {
			ok: false,
			message: `A batch holds at most ${batching.limit} operations, got ${body.length}.`,
			code: 'BATCH_TOO_LARGE',
		};
	const entries: GraphQLParams[] = [];
	for (const [index, entry] of body.entries()) {
		const parsed: ParamsResult = paramsFromJson(entry);
		if (!parsed.ok)
			return {
				ok: false,
				message: `Batch entry ${index}: ${parsed.message}`,
				code: 'BATCH_INVALID',
			};
		entries.push(parsed.params);
	}
	return { ok: true, entries };
}
