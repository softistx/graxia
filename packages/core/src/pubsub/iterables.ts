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

/**
 * Applies the operators to `source` from left to right, as Yoga's `pipe`:
 * `pipe(a, f, g)` is `g(f(a))`.
 *
 * @example
 * pipe(pubsub.subscribe('post', id), filter((p) => p.published), map((p) => p.title))
 */
export function pipe<A>(a: A): A;
export function pipe<A, B>(a: A, ab: (value: A) => B): B;
export function pipe<A, B, C>(
	a: A,
	ab: (value: A) => B,
	bc: (value: B) => C,
): C;
export function pipe<A, B, C, D>(
	a: A,
	ab: (value: A) => B,
	bc: (value: B) => C,
	cd: (value: C) => D,
): D;
export function pipe<A, B, C, D, E>(
	a: A,
	ab: (value: A) => B,
	bc: (value: B) => C,
	cd: (value: C) => D,
	de: (value: D) => E,
): E;
export function pipe<A, B, C, D, E, F>(
	a: A,
	ab: (value: A) => B,
	bc: (value: B) => C,
	cd: (value: C) => D,
	de: (value: D) => E,
	ef: (value: E) => F,
): F;
export function pipe<A, B, C, D, E, F, G>(
	a: A,
	ab: (value: A) => B,
	bc: (value: B) => C,
	cd: (value: C) => D,
	de: (value: D) => E,
	ef: (value: E) => F,
	fg: (value: F) => G,
): G;
export function pipe<A, B, C, D, E, F, G, H>(
	a: A,
	ab: (value: A) => B,
	bc: (value: B) => C,
	cd: (value: C) => D,
	de: (value: D) => E,
	ef: (value: E) => F,
	fg: (value: F) => G,
	gh: (value: G) => H,
): H;
export function pipe<A, B, C, D, E, F, G, H, I>(
	a: A,
	ab: (value: A) => B,
	bc: (value: B) => C,
	cd: (value: C) => D,
	de: (value: D) => E,
	ef: (value: E) => F,
	fg: (value: F) => G,
	gh: (value: G) => H,
	hi: (value: H) => I,
): I;
export function pipe<A, B, C, D, E, F, G, H, I, J>(
	a: A,
	ab: (value: A) => B,
	bc: (value: B) => C,
	cd: (value: C) => D,
	de: (value: D) => E,
	ef: (value: E) => F,
	fg: (value: F) => G,
	gh: (value: G) => H,
	hi: (value: H) => I,
	ij: (value: I) => J,
): J;
/** Any longer chain: the operators are applied in order, the result type is not tracked. */
export function pipe(
	source: unknown,
	...operators: ((value: never) => unknown)[]
): unknown;
export function pipe(
	source: unknown,
	...operators: ((value: never) => unknown)[]
): unknown {
	return operators.reduce(
		(value, operator) => operator(value as never),
		source,
	);
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
