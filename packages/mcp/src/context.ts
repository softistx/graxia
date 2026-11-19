import { AsyncLocalStorage } from 'node:async_hooks';

/** Carries a request's `serverContext` from `fetch` to the SDK's per-request factory. */
export interface ContextCarrier {
	/** Runs `fn` with `serverContext` as the current one. */
	run<T>(serverContext: object, fn: () => T): T;
	/** The `serverContext` of the request being handled; throws outside `run`. */
	current(): object;
}

export function createContextCarrier(): ContextCarrier {
	const storage = new AsyncLocalStorage<object>();
	return {
		run: (serverContext, fn) => storage.run(serverContext, fn),
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
