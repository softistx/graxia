import type { StreamFormat } from './stream';

const encoder = new TextEncoder();

/**
 * The framing of a `multipart/mixed` response (incremental delivery over
 * HTTP): boundary `-`, one JSON part per payload, then the closing boundary.
 * Clients such as Apollo Client and `meros` read it. No keep-alive: the
 * response is finite.
 */
export const multipartFormat: StreamFormat = {
	headers: () =>
		new Headers({
			'content-type': 'multipart/mixed; boundary="-"',
			'cache-control': 'no-cache',
			'x-accel-buffering': 'no',
		}),
	chunk: (data) =>
		encoder.encode(
			`\r\n---\r\ncontent-type: application/json; charset=utf-8\r\n\r\n${JSON.stringify(data)}`,
		),
	close: encoder.encode('\r\n-----\r\n'),
};
