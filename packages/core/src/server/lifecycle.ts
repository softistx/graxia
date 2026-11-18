/** @internal What the lifecycle needs to end an open WebSocket. */
export interface ClosableSocket {
	/** Closes the socket with a code and reason. */
	close(code: number, reason: string): void;
}

/** @internal What `createGraxia` shares with the transport to drain on dispose. */
export interface Lifecycle {
	/** Aborts when shutdown gives up waiting; every operation's signal includes it. */
	readonly shutdown: AbortSignal;
	/** Aborts as soon as `close` is called: open event streams end gracefully. */
	readonly stopping: AbortSignal;
	/** True once `close` was called. */
	readonly closing: boolean;
	/** Tracks `work` until it settles. */
	track<T>(work: Promise<T>): Promise<T>;
	/** Stops accepting work (`closing`) and closes every registered socket with 1001. */
	close(): void;
	/** Registers an open socket for `close()`; returns its unregister function. */
	register(socket: ClosableSocket): () => void;
	/**
	 * Waits for tracked work up to `timeout` ms, then aborts `shutdown` and
	 * waits at most `timeout` ms more. Resolves to the number of operations
	 * still pending.
	 */
	drain(timeout: number): Promise<number>;
}

/** @internal Tracks in-flight requests and owns the shutdown signal. */
export function createLifecycle(): Lifecycle {
	const controller = new AbortController();
	const stopping = new AbortController();
	const inflight = new Set<Promise<unknown>>();
	const sockets = new Set<ClosableSocket>();
	let closing = false;
	const settled = async () => {
		while (inflight.size > 0) await Promise.allSettled([...inflight]);
	};
	return {
		shutdown: controller.signal,
		stopping: stopping.signal,
		get closing() {
			return closing;
		},
		track(work) {
			inflight.add(work);
			const done = () => inflight.delete(work);
			work.then(done, done);
			return work;
		},
		register(socket) {
			sockets.add(socket);
			return () => sockets.delete(socket);
		},
		close() {
			closing = true;
			stopping.abort(new Error('graxia is closing'));
			for (const socket of sockets) socket.close(1001, 'Going away');
		},
		async drain(timeout) {
			const within = async (ms: number) => {
				let timer: ReturnType<typeof setTimeout> | undefined;
				const expired = new Promise<void>((resolve) => {
					timer = setTimeout(resolve, ms);
				});
				await Promise.race([settled(), expired]);
				clearTimeout(timer);
				return inflight.size === 0;
			};
			if (!(await within(timeout))) {
				controller.abort(new Error('graxia is shutting down'));
				await within(timeout);
			}
			return inflight.size;
		},
	};
}
