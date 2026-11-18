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
	let finished = false;
	const close = async (): Promise<void> => {
		if (finished) return;
		finished = true;
		await inner.return?.();
	};
	return {
		async next() {
			while (!finished) {
				const result = await inner.next();
				if (result.done) {
					finished = true;
					break;
				}
				let boxed: { value: U } | undefined;
				try {
					boxed = await step(result.value);
				} catch (error) {
					await close();
					throw error;
				}
				if (boxed) return { done: false, value: boxed.value };
			}
			return { done: true, value: undefined };
		},
		async return() {
			await close();
			return { done: true, value: undefined };
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
