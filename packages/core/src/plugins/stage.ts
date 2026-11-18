import type { MaybePromise } from './types';

type AnyHook = (
	payload: never,
) => MaybePromise<void | ((done: never) => MaybePromise<void>)>;

/**
 * Outcome of one stage: what the hooks decided (`out`) and `runAfter`, which
 * runs the after-hooks of the hooks that ran, in reverse order.
 */
export interface StageOutcome<Out, Done> {
	/** Accumulated decisions of the hooks (short-circuit values, merged context, …). */
	readonly out: Out;
	/**
	 * The original value thrown by a hook, unwrapped. The runner never rejects
	 * for a hook error: hooks after the thrower are skipped and the caller
	 * decides what to do with `error`.
	 */
	readonly error?: unknown;
	/** Runs the after-hooks of the hooks that ran before any error (reverse order), awaited sequentially. */
	runAfter(done: Done): Promise<void>;
}

/** A stage runner: takes the stage input, returns the outcome. */
export type StageRunner<Input, Out, Done> = (
	input: Input,
) => Promise<StageOutcome<Out, Done>>;

/** @internal how one stage turns an input into per-hook payloads. */
export interface StageSpec<Input, Out> {
	init(input: Input): Out;
	/** Builds the payload for a hook; `stop` ends the stage after this hook. */
	payload(input: Input, out: Out, stop: () => void): unknown;
	/** Called with a hook's non-function return value (used by `onContext`). */
	collect?(out: Out, returned: unknown, plugin: string): void;
	/** `false` for a stage with no after-hook: a returned function is ignored, not collected. */
	afterHooks?: false;
}

const isThenable = (value: unknown): value is PromiseLike<unknown> =>
	typeof value === 'object' &&
	value !== null &&
	typeof (value as PromiseLike<unknown>).then === 'function';

/**
 * @internal Builds a runner over `hooks` (already ordered). With no hook the
 * runner skips all work and only builds the empty outcome. Hooks are awaited
 * sequentially; a synchronous hook adds no await.
 */
export function createStageRunner<Input, Out, Done>(
	hooks: readonly { plugin: string; run: AnyHook }[],
	spec: StageSpec<Input, Out>,
): StageRunner<Input, Out, Done> {
	const noAfter = async () => {};
	if (hooks.length === 0) {
		return async (input) => ({ out: spec.init(input), runAfter: noAfter });
	}
	return async (input) => {
		const out = spec.init(input);
		const afters: ((done: Done) => MaybePromise<void>)[] = [];
		let stopped = false;
		const stop = () => {
			stopped = true;
		};
		let error: unknown;
		let failed = false;
		for (const hook of hooks) {
			try {
				let returned: unknown = hook.run(
					spec.payload(input, out, stop) as never,
				);
				if (isThenable(returned)) returned = await returned;
				if (typeof returned === 'function') {
					if (spec.afterHooks !== false)
						afters.push(returned as (done: Done) => MaybePromise<void>);
				} else spec.collect?.(out, returned, hook.plugin);
			} catch (thrown) {
				error = thrown;
				failed = true;
				break;
			}
			if (stopped) break;
		}
		return {
			out,
			...(failed ? { error } : {}),
			async runAfter(done) {
				let first: unknown;
				let failed = false;
				for (let i = afters.length - 1; i >= 0; i--) {
					const after = afters[i] as (done: Done) => MaybePromise<void>;
					try {
						const pending = after(done);
						if (isThenable(pending)) await pending;
					} catch (thrown) {
						if (!failed) first = thrown;
						failed = true;
					}
				}
				if (failed) throw first;
			},
		};
	};
}
