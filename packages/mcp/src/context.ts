import { AsyncLocalStorage } from 'node:async_hooks';
import type { ToolCalls } from './calls';
import type { View } from './view';

/** What `fetch` knows about one request, for the SDK's per-request factory. */
export interface RequestState {
	/** The `serverContext` given to `fetch`. */
	serverContext: object;
	/** What the body asks of the tools. */
	calls: ToolCalls;
	/** The caller's view, built on first use and once. */
	view: () => Promise<View>;
}

/** Carries a request's state from `fetch` to the SDK's per-request factory. */
export interface ContextCarrier {
	/** Runs `fn` with `state` as the current one. */
	run<T>(state: RequestState, fn: () => T): T;
	/** The state of the request being handled; throws outside `run`. */
	current(): RequestState;
}

export function createContextCarrier(): ContextCarrier {
	const storage = new AsyncLocalStorage<RequestState>();
	return {
		run: (state, fn) => storage.run(state, fn),
		current() {
			const store = storage.getStore();
			if (store === undefined)
				throw new Error(
					'createMcp: no serverContext for this request; the MCP handler ran outside fetch.',
				);
			return store;
		},
	};
}
