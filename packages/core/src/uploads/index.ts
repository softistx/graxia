import { parseBatch } from '../http/batch';
import { paramsFromJson } from '../http/params';
import { refusal } from '../http/respond';
import type { Read } from '../server/read-request';
import type { Runtime } from '../server/runtime';
import { parseMap, placeFiles } from './map';
import type { ResolvedUploads } from './options';
import { decode, readParts } from './read';
import { invalid } from './refuse';

const PARAMS_FIX =
	'Send "operations" as a JSON object with "query" (a string) and, optionally, "variables" (an object) and "operationName" (a string).';
const BATCH_FIX =
	'Send one operation per request, or fewer operations in the batch.';

/**
 * Reads a GraphQL multipart request (spec: `operations`, `map`, one part per
 * file): the limits first, then the map, then the files set into `variables`.
 * Every refusal comes before any resolver can run.
 */
export async function readMultipart(
	rt: Runtime,
	request: Request,
	uploads: ResolvedUploads,
): Promise<Read> {
	const parts = await readParts(request, uploads, rt.options.bodyBytes);
	if ('response' in parts) return parts;
	const operations = decode(parts.operations);
	if (!operations)
		return {
			response: invalid('The "operations" field is not valid JSON.'),
		};
	const decoded = decode(parts.map);
	const map = parseMap(decoded?.value);
	if (!map.ok) return { response: invalid(map.message) };
	const placed = placeFiles(operations.value, map.map, parts.files);
	if (!placed.ok) return { response: invalid(placed.message) };
	if (Array.isArray(operations.value)) {
		const batch = parseBatch(operations.value, rt.options.batching);
		return batch.ok
			? { batch: batch.entries }
			: {
					response: refusal(400, batch.message, BATCH_FIX, {
						code: batch.code,
					}),
				};
	}
	const params = paramsFromJson(operations.value);
	return params.ok
		? { single: params.params }
		: {
				response: refusal(400, params.message, PARAMS_FIX, {
					code: 'PARAMS_INVALID',
				}),
			};
}
