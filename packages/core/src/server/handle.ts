import { parseBatch } from '../http/batch';
import { type BodyResult, isJsonContentType, readBody } from '../http/body';
import { type MediaType, negotiate } from '../http/negotiate';
import { paramsFromJson, paramsFromUrl } from '../http/params';
import { jsonResponse, refusal, statusOf } from '../http/respond';
import type { StateBag } from '../plugins/state';
import type { GraphQLParams } from '../plugins/types';
import { resultKey } from './execute-state';
import { runOperation } from './operation';
import type { Outcome } from './outcome';
import type { Runtime } from './runtime';

type Read =
	| { response: Response }
	| { single: GraphQLParams }
	| { batch: GraphQLParams[] };

interface Call {
	request: Request;
	/** The request's state (what `onRequest` saw). */
	state: StateBag;
	serverContext: Record<string, unknown>;
	method: 'GET' | 'POST';
}

/**
 * Answers a request that passed `onRequest`: negotiation, parameters,
 * operation(s), encoding. Never rejects. Every response varies by `Accept`.
 */
export async function dispatch(
	rt: Runtime,
	request: Request,
	serverContext: Record<string, unknown>,
	state: StateBag,
): Promise<Response> {
	try {
		state.responseHeaders.append('vary', 'Accept');
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
		const call: Call = { request, state, serverContext, method };
		if ('single' in read) {
			const outcome = await runOperation(rt, {
				...call,
				state: state.fork(),
				params: read.single,
			});
			return encode(rt, state, outcome, media);
		}
		return await runBatch(rt, read.batch, call, media);
	} catch (error) {
		return rt.unexpected.respond(error, state);
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
 * concurrency). Each entry has its own forked state. An entry that fails
 * unexpectedly (a hook or the executor threw) becomes the generic unexpected body at its place and the batch carries on; a `respond`
 * short-circuit (from `onParams`) answers the whole request.
 */
async function runBatch(
	rt: Runtime,
	entries: readonly GraphQLParams[],
	call: Call,
	media: MediaType,
): Promise<Response> {
	const results: unknown[] = [];
	for (const params of entries) {
		const state = call.state.fork();
		const outcome = await runOperation(rt, { ...call, state, params });
		if (outcome.kind === 'response') return outcome.response;
		if (outcome.kind === 'unexpected') {
			rt.unexpected.report(outcome.error, state, 'execution');
			results.push(rt.unexpected.body(state));
		} else results.push(rt.maskResult(outcome.result, state));
	}
	return jsonResponse(results, 200, media);
}

function encode(
	rt: Runtime,
	state: StateBag,
	outcome: Outcome,
	media: MediaType,
): Response {
	if (outcome.kind === 'response') return outcome.response;
	if (outcome.kind === 'unexpected')
		return rt.unexpected.respond(outcome.error, state, 'execution');
	const result = rt.maskResult(outcome.result, state);
	state.set(resultKey, result);
	return jsonResponse(
		result,
		outcome.status ?? statusOf(media, result),
		media,
		outcome.headers,
	);
}
