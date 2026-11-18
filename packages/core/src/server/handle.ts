import { parseBatch } from '../http/batch';
import { type BodyResult, isJsonContentType, readBody } from '../http/body';
import { type MediaType, negotiate } from '../http/negotiate';
import { paramsFromJson, paramsFromUrl } from '../http/params';
import { jsonResponse, refusal, statusOf } from '../http/respond';
import type { RequestState } from '../plugins/state';
import type { GraphQLParams } from '../plugins/types';
import { runOperation } from './operation';
import type { Outcome } from './outcome';
import type { Runtime } from './runtime';
import { handleUnexpected } from './unexpected';

type Read =
	| { response: Response }
	| { single: GraphQLParams }
	| { batch: GraphQLParams[] };

/**
 * Answers a request that passed `onRequest`: negotiation, parameters,
 * operation(s), encoding. Never rejects.
 */
export async function dispatch(
	rt: Runtime,
	request: Request,
	serverContext: Record<string, unknown>,
	state: RequestState,
): Promise<Response> {
	try {
		const media = negotiate(request.headers.get('accept'));
		if (media === undefined)
			return refusal(
				406,
				'The Accept header must allow application/graphql-response+json or application/json.',
			);
		const method = request.method === 'GET' ? 'GET' : 'POST';
		const read =
			method === 'GET' ? readGet(request) : await readPost(rt, request);
		if ('response' in read) return read.response;
		const base = { request, state, serverContext, method } as const;
		if ('single' in read)
			return encode(
				await runOperation(rt, { ...base, params: read.single }),
				media,
			);
		return await runBatch(rt, read.batch, base, media);
	} catch (error) {
		return handleUnexpected(error);
	}
}

function readGet(request: Request): Read {
	const parsed = paramsFromUrl(new URL(request.url));
	return parsed.ok
		? { single: parsed.params }
		: { response: refusal(400, parsed.message) };
}

async function readPost(rt: Runtime, request: Request): Promise<Read> {
	if (!isJsonContentType(request.headers.get('content-type')))
		return {
			response: refusal(
				415,
				'The Content-Type must be application/json (UTF-8).',
			),
		};
	const body: BodyResult = await readBody(request, rt.options.bodyBytes);
	if (body.kind === 'too-large')
		return { response: refusal(413, 'The request body is too large.') };
	if (body.kind === 'invalid') return { response: refusal(400, body.message) };
	let json: unknown;
	try {
		json = JSON.parse(body.text);
	} catch {
		return { response: refusal(400, 'The request body is not valid JSON.') };
	}
	if (Array.isArray(json)) {
		const batch = parseBatch(json, rt.options.batching);
		return batch.ok
			? { batch: batch.entries }
			: { response: refusal(400, batch.message) };
	}
	const parsed = paramsFromJson(json);
	return parsed.ok
		? { single: parsed.params }
		: { response: refusal(400, parsed.message) };
}

/**
 * Runs the entries one after the other, in order (a later entry may rely on
 * the effect of an earlier mutation, and one request cannot multiply its own
 * concurrency). A hook that short-circuits or fails ends the whole batch.
 */
async function runBatch(
	rt: Runtime,
	entries: readonly GraphQLParams[],
	base: {
		request: Request;
		state: RequestState;
		serverContext: Record<string, unknown>;
		method: 'GET' | 'POST';
	},
	media: MediaType,
): Promise<Response> {
	const results: unknown[] = [];
	for (const params of entries) {
		const outcome = await runOperation(rt, { ...base, params });
		if (outcome.kind !== 'result') return encode(outcome, media);
		results.push(outcome.result);
	}
	return jsonResponse(results, 200, media);
}

function encode(outcome: Outcome, media: MediaType): Response {
	if (outcome.kind === 'response') return outcome.response;
	if (outcome.kind === 'unexpected') return handleUnexpected(outcome.error);
	return jsonResponse(
		outcome.result,
		outcome.status ?? statusOf(media, outcome.result),
		media,
		outcome.headers,
	);
}
