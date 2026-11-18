/**
 * Keeps the events of `source` that pass `predicate`. A type guard narrows the
 * element type. `return()` is forwarded to the source, and a throw in
 * `predicate` returns the source then rejects.
 *
 * @example
 * subscribe: (_, { id }, ctx) =>
 *   filterIterable(pubsub.subscribe(`post:${id}`, { signal: ctx.signal }), (p) => p.published)
 */
export function filterIterable<T, S extends T>(
	source: AsyncIterable<T>,
	predicate: (value: T) => value is S,
): AsyncIterableIterator<S>;
export function filterIterable<T>(
	source: AsyncIterable<T>,
	predicate: (value: T) => boolean | Promise<boolean>,
): AsyncIterableIterator<T>;
export function filterIterable<T>(
	source: AsyncIterable<T>,
	predicate: (value: T) => boolean | Promise<boolean>,
): AsyncIterableIterator<T> {
	return derive(source, async (value) =>
		(await predicate(value)) ? { value } : undefined,
	);
}

/**
 * Maps each event of `source` through `fn` (sync or async). `return()` is
 * forwarded to the source, and a throw in `fn` returns the source then rejects.
 *
 * @example
 * mapIterable(pubsub.subscribe('tick'), (n) => ({ tick: n }))
 */
export function mapIterable<T, U>(
	source: AsyncIterable<T>,
	fn: (value: T) => U | Promise<U>,
): AsyncIterableIterator<U> {
	return derive(source, async (value) => ({ value: await fn(value) }));
}

/** Shared engine: `step` returns a box to emit, or `undefined` to skip. */
function derive<T, U>(
	source: AsyncIterable<T>,
	step: (value: T) => Promise<{ value: U } | undefined>,
): AsyncIterableIterator<U> {
	const inner = source[Symbol.asyncIterator]();
	const done = { done: true, value: undefined } as const;
	let finished = false;
	let chain: Promise<unknown> = Promise.resolve();

	const close = async (): Promise<void> => {
		if (finished) return;
		finished = true;
		await inner.return?.();
	};

	async function pull(): Promise<IteratorResult<U>> {
		while (!finished) {
			let result: IteratorResult<T>;
			try {
				result = await inner.next();
			} catch (error) {
				finished = true; // the source failed: it is already closed
				throw error;
			}
			if (result.done) {
				finished = true;
				break;
			}
			if (finished) break; // return() ran during the await
			let boxed: { value: U } | undefined;
			try {
				boxed = await step(result.value);
			} catch (error) {
				await close();
				throw error;
			}
			if (finished) break;
			if (boxed) return { done: false, value: boxed.value };
		}
		return done;
	}

	return {
		next() {
			// serialised: concurrent calls resolve in call order
			const run = chain.then(pull, pull);
			chain = run.catch(() => undefined);
			return run;
		},
		async return() {
			await close();
			return done;
		},
		async throw(error?: unknown) {
			await close();
			throw error;
		},
		[Symbol.asyncIterator]() {
			return this;
		},
	};
}
