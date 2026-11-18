import type { WebSocketHandler } from 'bun';
import type { Runtime } from '../server/runtime';
import { createConnection, type SocketData } from './connection';

/**
 * The Bun `WebSocketHandler` of an instance: one {@link Connection} per
 * socket. With `subscriptions.ws: false` it only closes whatever reaches it
 * (nothing is upgraded then).
 */
export function createWebSocketHandler(
	rt: Runtime,
): WebSocketHandler<SocketData> {
	const config = rt.options.ws;
	if (config === false)
		return {
			open: (ws) => ws.close(1008, 'WebSocket is disabled'),
			message() {},
		};
	return {
		maxPayloadLength: config.maxPayloadBytes,
		open: (ws) => {
			ws.data.connection = createConnection(rt, ws, config);
		},
		message: (ws, raw) => ws.data.connection?.message(raw),
		drain: (ws) => ws.data.connection?.drain(),
		close: (ws) => ws.data.connection?.closed(),
	};
}
