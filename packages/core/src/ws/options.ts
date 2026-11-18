import { GraxiaConfigError } from '../errors/config-error';
import type { RequestState } from '../plugins/state';
import type { MaybePromise } from '../plugins/types';

/** What `onConnect` and `onDisconnect` receive about one WebSocket connection. */
export interface WebSocketContext {
	/** The upgrade request (its headers, URL and cookies; the plugins' `onRequest` hooks already ran on it). */
	request: Request;
	/** The `payload` of the client's `connection_init`, `undefined` when it sent none. */
	connectionParams: Record<string, unknown> | undefined;
	/** The host's context, as given to `serve()` or `upgrade()`. */
	serverContext: Record<string, unknown>;
	/** The state of the upgrade request (what `onRequest` hooks stored). */
	state: RequestState;
}

/** The `subscriptions.ws` option: graphql-transport-ws on Bun's WebSocket. */
export interface WebSocketOptions {
	/**
	 * Milliseconds a socket may wait before sending `connection_init`; then it
	 * closes with 4408. 3 000 by default; a positive integer.
	 */
	connectionInitWaitTimeout?: number;
	/**
	 * Milliseconds between the server's `ping` messages. 12 000 by default;
	 * `0` turns them off. A non-negative integer (as `subscriptions.sse.keepAliveMs`).
	 */
	keepAliveMs?: number;
	/**
	 * The largest message in bytes; Bun closes the socket with 1009 above it.
	 * 1 MiB by default; a positive integer.
	 */
	maxPayloadBytes?: number;
	/**
	 * Called on `connection_init`, before the acknowledgement. Return `false`
	 * (or throw an `exposedError`) to refuse with 4403; return an object to
	 * send it as the `connection_ack` payload.
	 */
	onConnect?: (
		ctx: WebSocketContext,
	) => MaybePromise<boolean | Record<string, unknown> | undefined | void>;
	/** Called once when a connection that was acknowledged closes (any code). */
	onDisconnect?: (ctx: WebSocketContext) => MaybePromise<void>;
}

/** @internal The `ws` option with defaults applied; `undefined` in `ResolvedOptions` when it is off. */
export interface ResolvedWebSocket {
	connectionInitWaitTimeout: number;
	keepAliveMs: number;
	maxPayloadBytes: number;
	onConnect: WebSocketOptions['onConnect'];
	onDisconnect: WebSocketOptions['onDisconnect'];
}

const positive = (value: number) => Number.isInteger(value) && value > 0;

/** @internal Validates `subscriptions.ws`; `false` when WebSocket is off. */
export function resolveWebSocket(
	given: boolean | WebSocketOptions | undefined,
): ResolvedWebSocket | false {
	if (given === false) return false;
	const options = typeof given === 'object' ? given : {};
	const {
		connectionInitWaitTimeout = 3_000,
		keepAliveMs = 12_000,
		maxPayloadBytes = 1_048_576,
	} = options;
	if (!positive(connectionInitWaitTimeout))
		throw new GraxiaConfigError(
			'subscriptions.ws.connectionInitWaitTimeout must be a positive integer (milliseconds)',
		);
	if (!Number.isInteger(keepAliveMs) || keepAliveMs < 0)
		throw new GraxiaConfigError(
			'subscriptions.ws.keepAliveMs must be a non-negative integer (milliseconds, 0 turns pings off)',
		);
	if (!positive(maxPayloadBytes))
		throw new GraxiaConfigError(
			'subscriptions.ws.maxPayloadBytes must be a positive integer (bytes)',
		);
	return {
		connectionInitWaitTimeout,
		keepAliveMs,
		maxPayloadBytes,
		onConnect: options.onConnect,
		onDisconnect: options.onDisconnect,
	};
}
