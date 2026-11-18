import type { ExecutionResult, GraphQLFormattedError } from 'graphql';
import type { MediaType } from './negotiate';

const charset = '; charset=utf-8';

/** A JSON response in the negotiated media type. */
export function jsonResponse(
	body: unknown,
	status: number,
	media: MediaType,
	headers?: HeadersInit,
): Response {
	const out = new Headers(headers);
	out.set('content-type', media + charset);
	const text = JSON.stringify(body);
	// Declared so the telemetry can tell a small refusal from a big result without reading it.
	out.set('content-length', String(Buffer.byteLength(text)));
	return new Response(text, { status, headers: out });
}

/** An error body: `{ errors: [{ message }] }`. */
export function errorBody(
	message: string,
	code?: string,
): { errors: GraphQLFormattedError[] } {
	return {
		errors: [{ message, ...(code ? { extensions: { code } } : {}) }],
	};
}

/** A request-level refusal (400, 404, 405, 406, 413, 415…) as `application/json`. */
export function refusal(
	status: number,
	message: string,
	headers?: HeadersInit,
	code?: string,
): Response {
	return jsonResponse(
		errorBody(message, code),
		status,
		'application/json',
		headers,
	);
}

/**
 * The status of a GraphQL result.
 *
 * `application/json` answers 200 for any GraphQL result, errors included
 * (the legacy rule). `application/graphql-response+json` answers 400 when no
 * execution produced a `data` entry (parse, validation, operation selection
 * or variable coercion failed) and 200 otherwise, field errors included.
 */
export function statusOf(media: MediaType, result: ExecutionResult): number {
	if (media === 'application/json') return 200;
	return 'data' in result ? 200 : 400;
}
