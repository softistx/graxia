import type { PubSubIterator } from './types';

/** An operator: turns one async iterable into another, as GraphQL Yoga's `filter` and `map` return. */
export type Operator<T, U> = (source: AsyncIterable<T>) => PubSubIterator<U>;

/**
 * Keeps the events that pass `predicate`, as Yoga's `filter` (use it with
 * {@link pipe}). A type guard narrows the element type. `return()` is
 * forwarded to the source, and a throw in `predicate` returns the source then
 * rejects.
 *
 * @example
 * pipe(pubsub.subscribe('post', id), filter((p) => p.published))
 */
export function filter<T, S extends T>(
	predicate: (value: T) => value is S,
): Operator<T, S>;
export function filter<T>(
	predicate: (value: T) => boolean | Promise<boolean>,
): Operator<T, T>;
export function filter<T>(
	predicate: (value: T) => boolean | Promise<boolean>,
): Operator<T, T> {
	return (source) =>
		derive(source, async (value) =>
			(await predicate(value)) ? { value } : undefined,
		);
}

/**
 * Maps each event through `fn` (sync or async), as Yoga's `map`. `return()` is
 * forwarded to the source, and a throw in `fn` returns the source then rejects.
 *
 * @example
 * pipe(pubsub.subscribe('tick'), map((n) => ({ tick: n })))
 */
export function map<T, U>(fn: (value: T) => U | Promise<U>): Operator<T, U> {
	return (source) =>
		derive(source, async (value) => ({ value: await fn(value) }));
}

/** Shared engine: `step` returns a box to emit, or `undefined` to skip. */
function derive<T, U>(
	source: AsyncIterable<T>,
	step: (value: T) => Promise<{ value: U } | undefined>,
): PubSubIterator<U> {
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
