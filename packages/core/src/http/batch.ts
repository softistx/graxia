import type { GraphQLParams } from '../plugins/types';
import { type ParamsResult, paramsFromJson } from './params';

/** Batching option: off, or on with a most-entries limit. */
export type BatchingOption = false | { limit: number };

/** The entries of a batch, or the reason the batch is refused (a 400). */
export type BatchResult =
	| { ok: true; entries: GraphQLParams[] }
	| { ok: false; message: string };

/**
 * Validates a JSON array body as a batch. Off, an array is refused; on, it
 * must hold between 1 and `limit` entries, each a valid parameter object.
 */
export function parseBatch(
	body: readonly unknown[],
	batching: BatchingOption,
): BatchResult {
	if (batching === false)
		return { ok: false, message: 'Batching is not enabled on this server.' };
	if (body.length === 0)
		return { ok: false, message: 'A batch must hold at least one operation.' };
	if (body.length > batching.limit)
		return {
			ok: false,
			message: `A batch holds at most ${batching.limit} operations, got ${body.length}.`,
		};
	const entries: GraphQLParams[] = [];
	for (const [index, entry] of body.entries()) {
		const parsed: ParamsResult = paramsFromJson(entry);
		if (!parsed.ok)
			return { ok: false, message: `Batch entry ${index}: ${parsed.message}` };
		entries.push(parsed.params);
	}
	return { ok: true, entries };
}
