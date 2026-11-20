import {
	bindErrorHeaders,
	readErrorHttp,
	stripErrorHttp,
} from '../http/error-http';
import { multipartFormat } from '../http/multipart';
import { type MediaType, readAccept } from '../http/negotiate';
import { jsonResponse, refusal, statusOf } from '../http/respond';
import { sseFormat } from '../http/sse';
import type { StreamFormat } from '../http/stream';
import type { StateBag } from '../plugins/state';
import type { GraphQLParams } from '../plugins/types';
import { batchedKey } from '../telemetry/spans';
import { resultKey } from './execute-state';
import { runOperation } from './operation';
import type { Outcome } from './outcome';
import { readGet, readPost } from './read-request';
import type { Runtime } from './runtime';
import { streamResponse } from './stream-response';

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
		const reading = readAccept(request.headers.get('accept'));
		const sse = rt.options.sse && reading.eventStream;
		const streams = !sse && rt.options.incremental !== false;
		const preferred = streams && reading.multipart;
		// JSON listed first (clients that list JSON first, such as GraphiQL) still streams an incremental operation.
		const multipart = preferred || (streams && reading.acceptsMultipart);
		const media = sse || preferred ? 'application/json' : reading.media;
		if (media === undefined)
			return refusal(
				406,
				'The Accept header must allow application/graphql-response+json or application/json.',
				'Send "Accept: application/graphql-response+json" (or application/json).',
				{ code: 'NOT_ACCEPTABLE' },
			);
		const method = request.method === 'GET' ? 'GET' : 'POST';
		const read =
			method === 'GET' ? readGet(request) : await readPost(rt, request);
		if ('response' in read) return read.response;
		const call: Call = { request, state, serverContext, method };
		if ('single' in read) {
			const operation = state.fork();
			const outcome = await runOperation(rt, {
				...call,
				state: operation,
				params: read.single,
				sse,
				multipart,
			});
			if (sse)
				return encodeStreamed(
					rt,
					{ ...call, state: operation },
					outcome,
					sseFormat,
				);
			return multipart && outcome.kind === 'stream'
				? streamResponse(
						rt,
						{ ...call, state: operation },
						outcome,
						multipartFormat,
					)
				: encode(rt, state, outcome, media);
		}
		if (sse || preferred)
			return refusal(
				400,
				`Batched operations cannot be sent over ${sse ? 'text/event-stream' : 'multipart/mixed'}.`,
				'Send one operation, or ask for a JSON response to batch several.',
				{ code: 'BATCH_NOT_STREAMABLE' },
			);
		return await runBatch(rt, read.batch, call, media);
	} catch (error) {
		return rt.unexpected.respond(error, state);
	}
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
		state.set(batchedKey, true);
		const outcome = await runOperation(rt, { ...call, state, params });
		if (outcome.kind === 'response') return outcome.response;
		if (outcome.kind === 'unexpected') {
			rt.unexpected.report(outcome.error, state, 'execution');
			results.push(rt.unexpected.body(state));
		} else if (outcome.kind === 'result')
			results.push(
				rt.options.errorHttp
					? stripErrorHttp(rt.maskResult(outcome.result, state))
					: rt.maskResult(outcome.result, state),
			);
		else results.push(rt.unexpected.body(state));
	}
	return jsonResponse(results, 200, media);
}

/**
 * The answer over a stream format (`text/event-stream`): the operation's results as events.
 * What fails before an operation exists (a status was chosen: bad params,
 * mutation over GET, aborted) keeps its plain HTTP answer; a parse, validation
 * or execution error is a `next` event, as the protocol asks.
 */
function encodeStreamed(
	rt: Runtime,
	call: Call,
	outcome: Outcome,
	format: StreamFormat,
): Response {
	if (outcome.kind === 'response') return outcome.response;
	if (outcome.kind === 'unexpected')
		return rt.unexpected.respond(outcome.error, call.state, 'execution');
	if (outcome.kind === 'result' && outcome.status !== undefined)
		return jsonResponse(
			outcome.result,
			outcome.status,
			'application/json',
			outcome.headers,
		);
	return streamResponse(rt, call, outcome, format);
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
	if (outcome.kind === 'stream')
		return rt.unexpected.respond(
			new Error('A stream outcome needs an event-stream request'),
			state,
			'execution',
		);
	const result = rt.maskResult(outcome.result, state);
	state.set(resultKey, result);
	const { refusal } = outcome;
	// Read from the masked result: a masked error carries nothing but what the masker kept.
	const asked = rt.options.errorHttp ? readErrorHttp(result, media) : undefined;
	const headers = outcome.headers ?? refusal?.headers;
	const response = jsonResponse(
		asked?.result ?? result,
		outcome.status ??
			refusal?.status ??
			asked?.status ??
			statusOf(media, result),
		media,
		headers,
	);
	// Added by `seal`, after the plugins' headers (an `onResponse` one included), to this Response only.
	return asked?.headers ? bindErrorHeaders(response, asked.headers) : response;
}
