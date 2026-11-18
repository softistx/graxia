/** @internal What `createGraxia` shares with the transport to drain on dispose. */
export interface Lifecycle {
	/** Aborts when shutdown gives up waiting; every operation's signal includes it. */
	readonly shutdown: AbortSignal;
	/** True once `close` was called. */
	readonly closing: boolean;
	/** Tracks `work` until it settles. */
	track<T>(work: Promise<T>): Promise<T>;
	/** Stops accepting work (`closing`). */
	close(): void;
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
	const inflight = new Set<Promise<unknown>>();
	let closing = false;
	const settled = async () => {
		while (inflight.size > 0) await Promise.allSettled([...inflight]);
	};
	return {
		shutdown: controller.signal,
		get closing() {
			return closing;
		},
		track(work) {
			inflight.add(work);
			const done = () => inflight.delete(work);
			work.then(done, done);
			return work;
		},
		close() {
			closing = true;
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
