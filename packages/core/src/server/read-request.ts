import { parseBatch } from '../http/batch';
import { type BodyResult, isJsonContentType, readBody } from '../http/body';
import { paramsFromJson, paramsFromUrl } from '../http/params';
import { refusal } from '../http/respond';
import type { GraphQLParams } from '../plugins/types';
import { readMultipart } from '../uploads';
import { isMultipart } from '../uploads/read';
import { notEnabled } from '../uploads/refuse';
import type { Runtime } from './runtime';

const PARAMS_FIX =
	'Send a JSON object with "query" (a string) and, optionally, "variables" (an object) and "operationName" (a string).';
const BATCH_FIX =
	'Send one operation per request, or fewer operations in the batch.';

/** What a request carries: its operation(s), or the refusal to send. */
export type Read =
	| { response: Response }
	| { single: GraphQLParams }
	| { batch: GraphQLParams[] };

export function readGet(request: Request): Read {
	const parsed = paramsFromUrl(new URL(request.url));
	return parsed.ok
		? { single: parsed.params }
		: { response: refusal(400, parsed.message, PARAMS_FIX) };
}

export async function readPost(rt: Runtime, request: Request): Promise<Read> {
	if (isMultipart(request.headers.get('content-type')))
		return rt.options.uploads
			? readMultipart(rt, request, rt.options.uploads)
			: { response: notEnabled() };
	if (isMultipart(request.headers.get('content-type')))
		return rt.options.uploads
			? readMultipart(rt, request, rt.options.uploads)
			: { response: notEnabled() };
	if (!isJsonContentType(request.headers.get('content-type')))
		return {
			response: refusal(
				415,
				'The Content-Type must be application/json (UTF-8).',
				'Send the body as JSON with "Content-Type: application/json".',
			),
		};
	const body: BodyResult = await readBody(request, rt.options.bodyBytes);
	if (body.kind === 'too-large')
		return {
			response: refusal(
				413,
				'The request body is too large.',
				'Send a smaller body.',
			),
		};
	if (body.kind === 'invalid')
		return { response: refusal(400, body.message, PARAMS_FIX) };
	let json: unknown;
	try {
		json = JSON.parse(body.text);
	} catch {
		return {
			response: refusal(
				400,
				'The request body is not valid JSON.',
				'Send a valid JSON object { "query": "..." } as the body.',
			),
		};
	}
	if (Array.isArray(json)) {
		const batch = parseBatch(json, rt.options.batching);
		return batch.ok
			? { batch: batch.entries }
			: { response: refusal(400, batch.message, BATCH_FIX) };
	}
	const parsed = paramsFromJson(json);
	return parsed.ok
		? { single: parsed.params }
		: { response: refusal(400, parsed.message, PARAMS_FIX) };
}
