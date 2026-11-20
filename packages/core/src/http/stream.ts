/** How one transport frames the payloads of a stream. */
export interface StreamFormat {
	/** The response headers. */
	headers(): Headers;
	/** Written first, so a client knows it is connected; none when the first payload is quick. */
	open?: Uint8Array;
	/** Written every `keepAliveMs` while idle; none for a finite response. */
	keepAlive?: Uint8Array;
	/** One payload, framed. */
	chunk(data: unknown): Uint8Array;
	/** Written when the stream ends gracefully (not when the client left). */
	close: Uint8Array;
}

/** What {@link payloadStream} needs. */
export interface PayloadStreamInit {
	/** Where the results come from. Its `return()` is called when the stream ends. */
	source: AsyncIterator<unknown>;
	/** Runs `work` (a pull of `source`) in the operation's scope, e.g. its `AsyncLocalStorage`. */
	scope<T>(work: () => T): T;
	/** How the payloads are framed on the wire (SSE events, multipart parts). */
	format: StreamFormat;
	/** Turns a source value into the data of one payload; a throw ends the stream through `fail`. */
	prepare(value: unknown): Promise<unknown>;
	/** The data of the last payload after the source or `prepare` threw. */
	fail(error: unknown): unknown | Promise<unknown>;
	/** Milliseconds between keep-alive chunks; 0 sends none (also ignored when the format has none). */
	keepAliveMs: number;
	/** Aborts when the stream must end now: the client left, or the server is closing. */
	stop: AbortSignal;
	/** Aborts when the client left: nothing more is written. */
	clientGone: AbortSignal;
	/** Called once when the stream ends, whatever the cause. */
	release(): void;
}

/**
 * A response body over an async source: one framed payload per source value
 * (pulled one at a time, so a slow client slows the source), the format's
 * keep-alive every `keepAliveMs`, then its closing bytes. Resolves `done`
 * once the stream is over and its resources are released.
 */
export function payloadStream(init: PayloadStreamInit): {
	body: ReadableStream<Uint8Array>;
	done: Promise<void>;
} {
	let finish!: (graceful: boolean) => void;
	let finished = false;
	let timer: ReturnType<typeof setInterval> | undefined;
	const { promise: done, resolve } = Promise.withResolvers<void>();
	const onStopped = () => resolveStop('stop');
	let resolveStop!: (value: 'stop') => void;
	const stopped = new Promise<'stop'>((resolvePromise) => {
		resolveStop = resolvePromise;
		if (init.stop.aborted) resolveStop('stop');
		else init.stop.addEventListener('abort', onStopped, { once: true });
	});
	const body = new ReadableStream<Uint8Array>(
		{
			start(controller) {
				finish = (graceful) => {
					if (finished) return;
					finished = true;
					clearInterval(timer);
					try {
						if (graceful && !init.clientGone.aborted)
							controller.enqueue(init.format.close);
						controller.close();
					} catch {
						// The client already cancelled.
					}
					init.stop.removeEventListener('abort', onStopped);
					init.stop.removeEventListener('abort', onAbort);
					try {
						init.release();
					} catch {
						// Releasing must not keep `done` pending.
					}
					// A throw or a rejection of `return()` must not keep `done` pending either.
					try {
						Promise.resolve(init.source.return?.())
							.catch(() => {})
							.finally(resolve);
					} catch {
						resolve();
					}
				};
				const onAbort = () => finish(true);
				init.stop.addEventListener('abort', onAbort, { once: true });
				if (init.stop.aborted) finish(true);
				// Flushes the headers before the first event, so a client knows it is connected.
				if (finished) return;
				const { open, keepAlive } = init.format;
				if (open) controller.enqueue(open);
				if (keepAlive && init.keepAliveMs > 0)
					timer = setInterval(() => {
						if (!finished) controller.enqueue(keepAlive);
					}, init.keepAliveMs);
			},
			async pull(controller) {
				if (finished) return;
				const pending = init.scope(() => init.source.next());
				pending.catch(() => {});
				try {
					const step = await Promise.race([pending, stopped]);
					if (finished) return;
					if (step === 'stop' || step.done) return finish(true);
					const data = await init.scope(() => init.prepare(step.value));
					if (!finished) controller.enqueue(init.format.chunk(data));
				} catch (error) {
					if (finished) return;
					const last = await init.scope(() => init.fail(error));
					if (finished) return;
					controller.enqueue(init.format.chunk(last));
					finish(true);
				}
			},
			cancel() {
				finish(false);
			},
		},
		{ highWaterMark: 1 },
	);
	return { body, done };
}
