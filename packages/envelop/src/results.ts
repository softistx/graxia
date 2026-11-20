import type { ExecutionOutput } from '@softistx/graxia';

export const isAsyncIterable = (
	value: unknown,
): value is AsyncIterable<unknown> =>
	typeof value === 'object' &&
	value !== null &&
	typeof (value as AsyncIterable<unknown>)[Symbol.asyncIterator] === 'function';

interface Incremental {
	initialResult: unknown;
	subsequentResults: AsyncIterator<unknown>;
}

const isIncremental = (value: unknown): value is Incremental =>
	typeof value === 'object' &&
	value !== null &&
	'initialResult' in value &&
	typeof (value as Incremental).subsequentResults?.next === 'function';

/**
 * The result as Envelop's done-hooks expect it: an incremental result
 * (`{ initialResult, subsequentResults }`) becomes an async iterable of its
 * payloads, anything else stays as is.
 */
export function present(output: unknown): unknown {
	if (!isIncremental(output)) return output;
	const { initialResult, subsequentResults } = output;
	let first = true;
	const iterator: AsyncIterableIterator<unknown> = {
		[Symbol.asyncIterator]: () => iterator,
		next() {
			if (!first) return subsequentResults.next();
			first = false;
			return Promise.resolve({ done: false, value: initialResult });
		},
		return: () =>
			subsequentResults.return?.() ??
			Promise.resolve({ done: true, value: undefined }),
	};
	return iterator;
}

/**
 * The inverse of {@link present} for a query: an async iterable of payloads
 * is pulled for its first one and rebuilt as `{ initialResult, subsequentResults }`.
 */
export async function rebuild(output: unknown): Promise<ExecutionOutput> {
	if (!isAsyncIterable(output) || isIncremental(output))
		return output as ExecutionOutput;
	const iterator = output[Symbol.asyncIterator]();
	const first = await iterator.next();
	if (first.done) return { data: null } as ExecutionOutput;
	return {
		initialResult: first.value,
		subsequentResults: {
			[Symbol.asyncIterator]() {
				return this;
			},
			next: () => iterator.next(),
			return: () =>
				iterator.return?.() ??
				Promise.resolve({ done: true, value: undefined }),
			throw: (error: unknown) =>
				iterator.throw?.(error) ?? Promise.reject(error),
		},
	} as unknown as ExecutionOutput;
}

/** Runs `each` on every payload of `source`, which may replace it (`onNext`). */
export function mapPayloads(
	source: AsyncIterable<unknown>,
	each: (payload: unknown) => Promise<unknown>,
): AsyncIterableIterator<unknown> {
	const iterator = source[Symbol.asyncIterator]();
	const mapped: AsyncIterableIterator<unknown> = {
		[Symbol.asyncIterator]: () => mapped,
		async next() {
			const step = await iterator.next();
			return step.done ? step : { done: false, value: await each(step.value) };
		},
		return: () =>
			iterator.return?.() ?? Promise.resolve({ done: true, value: undefined }),
		throw: (error) => iterator.throw?.(error) ?? Promise.reject(error),
	};
	return mapped;
}

/** Calls `onEnd` once, when `source` is exhausted or released (`onEnd`). */
export function onceDone(
	source: AsyncIterable<unknown>,
	onEnd: () => void,
): AsyncIterableIterator<unknown> {
	const iterator = source[Symbol.asyncIterator]();
	let done = false;
	const finish = () => {
		if (done) return;
		done = true;
		onEnd();
	};
	const wrapped: AsyncIterableIterator<unknown> = {
		[Symbol.asyncIterator]: () => wrapped,
		async next() {
			const step = await iterator.next();
			if (step.done) finish();
			return step;
		},
		async return(value) {
			try {
				return (await iterator.return?.(value)) ?? { done: true, value };
			} finally {
				finish();
			}
		},
		throw: (error) => iterator.throw?.(error) ?? Promise.reject(error),
	};
	return wrapped;
}

/** Hands a failure of `source` to `onError`, which throws the (maybe replaced) error (`onSubscribeError`). */
export function onFailure(
	source: AsyncIterable<unknown>,
	onError: (error: unknown) => never,
): AsyncIterableIterator<unknown> {
	const iterator = source[Symbol.asyncIterator]();
	const guarded: AsyncIterableIterator<unknown> = {
		[Symbol.asyncIterator]: () => guarded,
		next: () => iterator.next().catch(onError),
		return: () =>
			iterator.return?.() ?? Promise.resolve({ done: true, value: undefined }),
		throw: (error) => iterator.throw?.(error) ?? Promise.reject(error),
	};
	return guarded;
}
