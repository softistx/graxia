const encoder = new TextEncoder();

const COMMENT = encoder.encode(':\n\n');
const COMPLETE = encoder.encode('event: complete\ndata:\n\n');

/** The headers of an event stream response. */
export function sseHeaders(): Headers {
	return new Headers({
		'content-type': 'text/event-stream; charset=utf-8',
		'cache-control': 'no-cache',
		'x-accel-buffering': 'no',
	});
}

/** One `next` event (`JSON.stringify` never emits a raw newline, so one `data` line is enough). */
export function nextEvent(data: unknown): Uint8Array {
	return encoder.encode(`event: next\ndata: ${JSON.stringify(data)}\n\n`);
}

/** What {@link eventStream} needs. */
export interface EventStreamInit {
	/** Where the results come from. Its `return()` is called when the stream ends. */
	source: AsyncIterator<unknown>;
	/** Runs `work` (a pull of `source`) in the operation's scope, e.g. its `AsyncLocalStorage`. */
	scope<T>(work: () => T): T;
	/** Turns a source value into the data of a `next` event; a throw ends the stream through `fail`. */
	prepare(value: unknown): Promise<unknown>;
	/** The data of the last `next` event after the source or `prepare` threw. */
	fail(error: unknown): unknown;
	/** Milliseconds between keep-alive comments. */
	keepAliveMs: number;
	/** Aborts when the stream must end now: the client left, or the server is closing. */
	stop: AbortSignal;
	/** Aborts when the client left: nothing more is written. */
	clientGone: AbortSignal;
	/** Called once when the stream ends, whatever the cause. */
	release(): void;
}

/**
 * A `text/event-stream` body over an async source: `next` events (pulled one
 * at a time, so a slow client slows the source), a keep-alive comment every
 * `keepAliveMs`, then `complete`. Resolves `done` once the stream is over
 * and its resources are released.
 */
export function eventStream(init: EventStreamInit): {
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
							controller.enqueue(COMPLETE);
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
				controller.enqueue(COMMENT);
				timer = setInterval(() => {
					if (!finished) controller.enqueue(COMMENT);
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
					if (!finished) controller.enqueue(nextEvent(data));
				} catch (error) {
					if (finished) return;
					controller.enqueue(nextEvent(init.fail(error)));
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
