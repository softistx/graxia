import { createRequestId, requestIdKey } from '../http/request-id';
import { StateBag } from '../plugins/state';
import type { SocketData } from '../ws/connection';
import { createWebSocketHandler } from '../ws/handler';
import { isUpgradeRequest, upgradeRequest } from '../ws/upgrade';
import { recordClientAddress } from './client-address';
import type { OptionsArg, ServerContextArg } from './host-context';
import { handle, lastResort, shuttingDown } from './request';
import type { Runtime } from './runtime';
import { seal } from './seal';
import type { GraxiaServeOptions } from './serve-options';

/** @internal What `createGraxia` exposes besides `execute` and `dispose`. */
export interface Entry<HostCtx extends object> {
	/** The shared request pipeline: request id, shutdown refusal, tracking, sealing. */
	handleWith(
		request: Request,
		serverContext: Record<string, unknown>,
		state?: StateBag,
	): Promise<Response>;
	fetch(
		request: Request,
		...serverContext: ServerContextArg<HostCtx>
	): Promise<Response>;
	serve(
		...options: OptionsArg<HostCtx, GraxiaServeOptions>
	): Bun.Server<SocketData>;
	upgrade(
		request: Request,
		server: Bun.Server<SocketData>,
		...serverContext: ServerContextArg<HostCtx>
	): Promise<Response | undefined>;
	isUpgrade(request: Request): boolean;
	websocket: Bun.WebSocketHandler<SocketData>;
}

/**
 * @internal The ways in: `fetch`, `serve`, and the WebSocket `upgrade` with its
 * handler. `servers` collects what `serve` starts, for `dispose`.
 */
export function createEntry<HostCtx extends object>(
	rt: Runtime,
	servers: Bun.Server<SocketData>[],
): Entry<HostCtx> {
	const { lifecycle } = rt;
	const handleWith: Entry<HostCtx>['handleWith'] = async (
		request,
		serverContext,
		state = new StateBag(),
	) => {
		state.set(requestIdKey, createRequestId());
		recordClientAddress(state, request, serverContext);
		if (lifecycle.closing) return seal(shuttingDown(), state);
		try {
			return seal(
				await lifecycle.track(handle(rt, request, serverContext, state)),
				state,
			);
		} catch (error) {
			return lastResort(rt, error, state);
		}
	};
	/** The refusal of an upgrade, sealed; `undefined` once the socket is upgraded. */
	const upgradeWith = async (
		request: Request,
		server: Bun.Server<SocketData>,
		serverContext: Record<string, unknown>,
	): Promise<Response | undefined> => {
		const state = new StateBag();
		state.set(requestIdKey, createRequestId());
		recordClientAddress(state, request, serverContext);
		try {
			if (lifecycle.closing) return seal(shuttingDown(), state);
			const refusal = await upgradeRequest(
				rt,
				request,
				server,
				serverContext,
				state,
			);
			return refusal && seal(refusal, state);
		} catch (error) {
			return lastResort(rt, error, state);
		}
	};
	const isUpgrade = (request: Request) =>
		rt.options.ws !== false && isUpgradeRequest(request);
	const websocket = createWebSocketHandler(rt);
	return {
		handleWith,
		websocket,
		fetch: (request, ...[serverContext]) =>
			handleWith(request, { ...serverContext }),
		isUpgrade,
		upgrade: (request, server, ...[serverContext]) => {
			const context = { ...serverContext };
			// Not an upgrade: the plain pipeline, so hooks run once.
			return isUpgrade(request)
				? upgradeWith(request, server, { ...context, server })
				: handleWith(request, { ...context, server });
		},
		serve: (...[serveOptions]) => {
			const { serverContext, ...bunOptions } = serveOptions ?? {};
			const server = Bun.serve<SocketData>({
				...(bunOptions as GraxiaServeOptions),
				websocket,
				fetch: (request, server) => {
					const context = { ...serverContext, server };
					return isUpgrade(request)
						? upgradeWith(request, server, context)
						: handleWith(request, context);
				},
			});
			servers.push(server);
			return server;
		},
	};
}
