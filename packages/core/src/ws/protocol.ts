import { isRecord } from '../http/record';
import type { StreamFormat } from '../http/stream';

/** The WebSocket subprotocol graxia speaks. */
export const SUBPROTOCOL = 'graphql-transport-ws';

/** The close codes of graphql-transport-ws (plus the standard ones graxia uses). */
export const CloseCode = {
	GoingAway: 1001,
	InternalError: 1011,
	BadRequest: 4400,
	Unauthorized: 4401,
	Forbidden: 4403,
	InitTimeout: 4408,
	AlreadyExists: 4409,
	TooManyInit: 4429,
} as const;

/** A message of the client, parsed. */
export type ClientMessage =
	| { type: 'connection_init'; payload?: Record<string, unknown> }
	| { type: 'ping' | 'pong'; payload?: Record<string, unknown> }
	| { type: 'subscribe'; id: string; payload: unknown }
	| { type: 'complete'; id: string };

/** A message of the server. */
export type ServerMessage =
	| { type: 'connection_ack'; payload?: Record<string, unknown> }
	| { type: 'ping' | 'pong'; payload?: Record<string, unknown> }
	| { type: 'next'; id: string; payload: unknown }
	| { type: 'error'; id: string; payload: readonly unknown[] }
	| { type: 'complete'; id: string };

/**
 * Parses one text frame; a string is the reason for the 4400 close when the
 * frame is not valid JSON, has no known `type`, or breaks that type's shape.
 */
export function parseMessage(raw: string | Buffer): ClientMessage | string {
	if (typeof raw !== 'string') return 'Binary messages are not supported';
	let json: unknown;
	try {
		json = JSON.parse(raw);
	} catch {
		return 'Invalid message received';
	}
	if (!isRecord(json) || typeof json['type'] !== 'string')
		return 'Invalid message received';
	const { type, id, payload } = json;
	const hasPayload = payload != null;
	if (hasPayload && !isRecord(payload) && type !== 'subscribe')
		return `Invalid "${type}" message: the payload must be an object`;
	const extra = hasPayload
		? { payload: payload as Record<string, unknown> }
		: {};
	switch (type) {
		case 'connection_init':
		case 'ping':
		case 'pong':
			return { type, ...extra };
		case 'subscribe':
			if (typeof id !== 'string' || id === '')
				return 'Invalid "subscribe" message: the id must be a non-empty string';
			if (!isRecord(payload))
				return 'Invalid "subscribe" message: the payload must be an object';
			return { type, id, payload };
		case 'complete':
			if (typeof id !== 'string' || id === '')
				return 'Invalid "complete" message: the id must be a non-empty string';
			return { type, id };
		default:
			return `Unknown message type "${type}"`;
	}
}

/** One server message as the text of a frame. */
export const encodeMessage = (message: ServerMessage): string =>
	JSON.stringify(message);

const encoder = new TextEncoder();

/**
 * How one operation's payloads are framed on the socket: a `next` message per
 * payload, then `complete`. The bytes are the UTF-8 of the text frame.
 */
export const operationFormat = (id: string): StreamFormat => ({
	headers: () => new Headers(),
	chunk: (data) =>
		encoder.encode(encodeMessage({ type: 'next', id, payload: data })),
	close: encoder.encode(encodeMessage({ type: 'complete', id })),
});
