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
	/** Waits for tracked work up to `timeout` ms, then aborts `shutdown` and waits for the rest. */
	drain(timeout: number): Promise<void>;
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
			let timer: ReturnType<typeof setTimeout> | undefined;
			const expired = new Promise<'timeout'>((resolve) => {
				timer = setTimeout(resolve, timeout, 'timeout');
			});
			const winner = await Promise.race([
				settled().then(() => 'done'),
				expired,
			]);
			clearTimeout(timer);
			if (winner === 'timeout') {
				controller.abort(new Error('graxia is shutting down'));
				await settled();
			}
		},
	};
}
