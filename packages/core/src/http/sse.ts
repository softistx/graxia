import type { StreamFormat } from './stream';

const encoder = new TextEncoder();

const COMMENT = encoder.encode(':\n\n');

/** The framing of a `text/event-stream` response: `next` events, then `complete`. */
export const sseFormat: StreamFormat = {
	headers: () =>
		new Headers({
			'content-type': 'text/event-stream; charset=utf-8',
			'cache-control': 'no-cache',
			'x-accel-buffering': 'no',
		}),
	open: COMMENT,
	keepAlive: COMMENT,
	// `JSON.stringify` never emits a raw newline, so one `data` line is enough.
	chunk: (data) =>
		encoder.encode(`event: next\ndata: ${JSON.stringify(data)}\n\n`),
	close: encoder.encode('event: complete\ndata:\n\n'),
};
