import type { ServerWebSocket } from 'bun';
import { encodeMessage, type ServerMessage } from './protocol';

const OPEN = 1;

/** What a connection does on its socket: write with backpressure, close. */
export interface SocketIo {
	/** Writes one message (or a ready-made text frame); waits when the socket is backed up. */
	send(message: ServerMessage | string): Promise<void>;
	/** Closes with a code and reason (a reason holds at most 123 bytes); idempotent. */
	close(code: number, reason: string): void;
	/** Bun's `drain`: wakes a `send` waiting on backpressure. */
	drain(): void;
}

/** The writing side of one socket. */
export function createSocketIo(ws: ServerWebSocket<unknown>): SocketIo {
	let drained: PromiseWithResolvers<void> | undefined;
	return {
		async send(message) {
			if (ws.readyState !== OPEN) return;
			const text =
				typeof message === 'string' ? message : encodeMessage(message);
			// -1: queued, but the socket is backed up; wait for Bun's `drain`.
			if (ws.sendText(text) === -1) {
				drained ??= Promise.withResolvers<void>();
				await drained.promise;
			}
		},
		close(code, reason) {
			try {
				ws.close(code, reason.slice(0, 120));
			} catch {
				// Already closed.
			}
		},
		drain() {
			drained?.resolve();
			drained = undefined;
		},
	};
}
