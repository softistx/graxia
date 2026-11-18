import { createStateKey, type RequestState } from '../plugins/state';

/** @internal The address of the client of a request, as `server.requestIP` gave it at the door. */
export const clientAddressKey = createStateKey<string>('clientAddress');

/**
 * @internal Records the client address when the host context carries the Bun
 * `server` (always with `serve()`): read later by the plugins of the request,
 * a WebSocket operation included (its request is a copy Bun cannot resolve).
 */
export function recordClientAddress(
	state: RequestState,
	request: Request,
	serverContext: Record<string, unknown>,
): void {
	const server = serverContext['server'] as
		| { requestIP?: (request: Request) => { address?: string } | null }
		| undefined;
	let address: string | undefined;
	try {
		address = server?.requestIP?.(request)?.address;
	} catch {
		// A closed socket or a host quirk: the address is optional, the request goes on.
		return;
	}
	if (typeof address === 'string' && address !== '')
		state.set(clientAddressKey, address);
}
