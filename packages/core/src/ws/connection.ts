import type { ServerWebSocket } from 'bun';
import { isGraxiaError } from '../errors/exposed';
import { paramsFromJson } from '../http/params';
import { isRecord } from '../http/record';
import type { StateBag } from '../plugins/state';
import type { Runtime } from '../server/runtime';
import { runSubscribe } from './operation';
import type { ResolvedWebSocket, WebSocketContext } from './options';
import { type ClientMessage, CloseCode, parseMessage } from './protocol';
import { createSocketIo, type SocketIo } from './socket';

/** What the upgrade attaches to a socket. */
export interface SocketData {
	/** The upgrade request. */
	request: Request;
	/** Its state, after the `onRequest` hooks; the request id is kept for the connection. */
	state: StateBag;
	/** The host's context. */
	serverContext: Record<string, unknown>;
	/** Set when the socket opens. */
	connection?: Connection;
}

/** The per-socket protocol state machine, driven by the Bun handler. */
export interface Connection {
	/** One text frame from the client. */
	message(raw: string | Buffer): Promise<void>;
	/** Bun's `drain`: the socket can take more data. */
	drain(): void;
	/** Bun's `close`: stops everything the connection started. */
	closed(): Promise<void>;
}

/** The mutable state of one connection, shared by its handlers. */
interface Conn {
	rt: Runtime;
	data: SocketData;
	config: ResolvedWebSocket;
	io: SocketIo;
	/** Aborts when the socket closes. */
	gone: AbortController;
	/** The active operations by id, each with the controller the client's `complete` aborts. */
	operations: Map<string, AbortController>;
	initReceived: boolean;
	acknowledged: boolean;
	connectionParams: Record<string, unknown> | undefined;
}

const contextOf = (c: Conn): WebSocketContext => ({
	request: c.data.request,
	connectionParams: c.connectionParams,
	serverContext: c.data.serverContext,
	state: c.data.state,
});

/** `connection_init`: runs `onConnect`, then acknowledges or closes. */
async function init(c: Conn, payload: Record<string, unknown> | undefined) {
	const { io, rt, config } = c;
	if (c.initReceived)
		return io.close(CloseCode.TooManyInit, 'Too many initialisation requests');
	c.initReceived = true;
	c.connectionParams = payload;
	let permitted: unknown;
	try {
		permitted = await config.onConnect?.(contextOf(c));
	} catch (error) {
		if (isGraxiaError(error)) return io.close(CloseCode.Forbidden, 'Forbidden');
		rt.unexpected.report(error, c.data.state, 'request');
		return io.close(CloseCode.InternalError, 'Internal error');
	}
	if (permitted === false) return io.close(CloseCode.Forbidden, 'Forbidden');
	c.acknowledged = true;
	await io.send({
		type: 'connection_ack',
		...(isRecord(permitted) ? { payload: permitted } : {}),
	});
}

/** `subscribe`: checks the id, then runs the operation in the background. */
function subscribe(c: Conn, id: string, payload: unknown) {
	const { io, operations, rt, data } = c;
	if (!c.acknowledged) return io.close(CloseCode.Unauthorized, 'Unauthorized');
	if (operations.has(id))
		return io.close(
			CloseCode.AlreadyExists,
			`Subscriber for ${id} already exists`,
		);
	const params = paramsFromJson(payload);
	if (!params.ok) return io.close(CloseCode.BadRequest, params.message);
	const stop = new AbortController();
	operations.set(id, stop);
	const work = runSubscribe(
		{
			rt,
			request: data.request,
			state: data.state,
			serverContext: {
				...data.serverContext,
				connectionParams: c.connectionParams,
			},
			send: io.send,
		},
		id,
		params.params,
		AbortSignal.any([c.gone.signal, stop.signal]),
	).finally(() => {
		// Only this operation's own entry: its id may have been reused already.
		if (operations.get(id) === stop) operations.delete(id);
	});
	void rt.lifecycle.track(work);
}

async function dispatch(c: Conn, message: ClientMessage) {
	switch (message.type) {
		case 'connection_init':
			return init(c, message.payload);
		case 'ping':
			return c.io.send({
				type: 'pong',
				...(message.payload ? { payload: message.payload } : {}),
			});
		case 'subscribe':
			return subscribe(c, message.id, message.payload);
		case 'complete':
			c.operations.get(message.id)?.abort();
			c.operations.delete(message.id);
			return;
		case 'pong':
			return;
	}
}

/**
 * Starts the protocol on an open socket: waits for `connection_init`
 * (`connectionInitWaitTimeout`), acknowledges it, pings every `keepAliveMs`,
 * runs each `subscribe` as an operation and tears everything down on close.
 */
export function createConnection(
	rt: Runtime,
	ws: ServerWebSocket<SocketData>,
	config: ResolvedWebSocket,
): Connection {
	const io = createSocketIo(ws);
	const c: Conn = {
		rt,
		data: ws.data,
		config,
		io,
		gone: new AbortController(),
		operations: new Map(),
		initReceived: false,
		acknowledged: false,
		connectionParams: undefined,
	};
	const initTimer = setTimeout(() => {
		if (!c.initReceived)
			io.close(CloseCode.InitTimeout, 'Connection initialisation timeout');
	}, config.connectionInitWaitTimeout);
	const pingTimer =
		config.keepAliveMs > 0
			? setInterval(() => void io.send({ type: 'ping' }), config.keepAliveMs)
			: undefined;
	const unregister = rt.lifecycle.register(io);
	if (rt.lifecycle.closing) io.close(CloseCode.GoingAway, 'Going away');
	return {
		async message(raw) {
			try {
				const message = parseMessage(raw);
				if (typeof message === 'string')
					return io.close(CloseCode.BadRequest, message);
				if (message.type === 'connection_init') clearTimeout(initTimer);
				await dispatch(c, message);
			} catch (error) {
				rt.unexpected.report(error, ws.data.state, 'request');
				io.close(CloseCode.InternalError, 'Internal error');
			}
		},
		drain: io.drain,
		async closed() {
			clearTimeout(initTimer);
			clearInterval(pingTimer);
			unregister();
			c.gone.abort();
			c.operations.clear();
			io.drain();
			if (!c.acknowledged) return;
			try {
				await config.onDisconnect?.(contextOf(c));
			} catch (error) {
				rt.unexpected.report(error, ws.data.state, 'request');
			}
		},
	};
}
