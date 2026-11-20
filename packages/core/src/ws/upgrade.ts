import { REQUEST_ID_HEADER, requestIdKey } from '../http/request-id';
import { refusal } from '../http/respond';
import type { StateBag } from '../plugins/state';
import { checkUpgrade } from '../security/check';
import type { Runtime } from '../server/runtime';
import type { SocketData } from './connection';
import { SUBPROTOCOL } from './protocol';

/** Whether `request` asks for a WebSocket upgrade. */
export function isUpgradeRequest(request: Request): boolean {
	return request.headers.get('upgrade')?.toLowerCase() === 'websocket';
}

/** The server's `upgrade`, as far as graxia needs it. */
export type Upgrader = {
	upgrade(
		request: Request,
		options: { data: SocketData; headers: HeadersInit },
	): boolean;
};

const offersSubprotocol = (request: Request): boolean =>
	(request.headers.get('sec-websocket-protocol') ?? '')
		.split(',')
		.some((protocol) => protocol.trim() === SUBPROTOCOL);

/**
 * Upgrades `request` to a graphql-transport-ws socket: the path, the method,
 * the plugins' `onRequest` hooks (they may `respond` to refuse it) and the
 * subprotocol are checked first. Gives `undefined` once the socket is
 * upgraded, else the refusal to send. Never rejects. `onResponse` hooks do
 * not run (the handshake response is Bun's).
 */
export async function upgradeRequest(
	rt: Runtime,
	request: Request,
	server: Upgrader,
	serverContext: Record<string, unknown>,
	state: StateBag,
): Promise<Response | undefined> {
	const { path } = rt.options;
	if (path !== false && new URL(request.url).pathname !== path)
		return refusal(
			404,
			'Not found.',
			`Open the WebSocket on the GraphQL path, ${path}.`,
		);
	if (request.method !== 'GET')
		return refusal(
			405,
			'A WebSocket upgrade must be a GET request.',
			'Open the connection with a GET request carrying the Upgrade: websocket header.',
			{ headers: { allow: 'GET' } },
		);
	const forbidden = checkUpgrade(rt, request);
	if (forbidden) return forbidden;
	try {
		await rt.ready;
		const entered = await rt.engine.runners.onRequest({ request, state });
		if (entered.error !== undefined)
			return rt.unexpected.respond(entered.error, state);
		const refused = entered.out.response;
		if (refused) {
			await entered.runAfter({ response: refused });
			return refused;
		}
		if (!offersSubprotocol(request))
			return refusal(
				400,
				`The Sec-WebSocket-Protocol header must offer "${SUBPROTOCOL}".`,
				`Open the socket with the "${SUBPROTOCOL}" subprotocol.`,
			);
		const headers = new Headers(state.responseHeaders);
		headers.set('sec-websocket-protocol', SUBPROTOCOL);
		headers.set(REQUEST_ID_HEADER, state.get(requestIdKey) ?? '');
		const data: SocketData = { request, state, serverContext };
		if (!server.upgrade(request, { data, headers }))
			return refusal(
				400,
				'The WebSocket upgrade failed.',
				'Send a valid WebSocket upgrade request (Upgrade, Connection and Sec-WebSocket-Key headers).',
			);
		// The socket is open: a failing after-hook is reported, never an answer.
		await entered
			.runAfter({ response: new Response(null, { status: 101 }) })
			.catch((error: unknown) => rt.unexpected.report(error, state));
		return undefined;
	} catch (error) {
		return rt.unexpected.respond(error, state);
	}
}
