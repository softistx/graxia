import { AsyncLocalStorage } from 'node:async_hooks';
import { GraxiaConfigError } from '../errors/config-error';

const storage = new AsyncLocalStorage<object>();

/** @internal Runs `work` with `context` as the current operation context. */
export function runWithContext<T>(context: object, work: () => T): T {
	return storage.run(context, work);
}

/**
 * The context of the operation being executed, from anywhere below a
 * resolver (helpers, data loaders, loggers) without passing it down. Throws a
 * `GraxiaConfigError` outside an operation, or when the instance has `asyncContext: false`.
 * Prefer the resolver's third argument; this is the opt-in shortcut.
 *
 * @example
 * const user = getContext<{ user: User }>().user;
 */
export function getContext<
	Ctx extends object = Record<string, unknown>,
>(): Ctx {
	const context = storage.getStore();
	if (context !== undefined) return context as Ctx;
	throw new GraxiaConfigError(
		'getContext() called outside a graxia operation, or the instance was created with asyncContext: false. Call it from a resolver (or code a resolver calls), leave asyncContext on, or use the resolver context argument.',
	);
}

/** Like {@link getContext}, but returns `undefined` outside an operation instead of throwing. */
export function tryGetContext<Ctx extends object = Record<string, unknown>>():
	| Ctx
	| undefined {
	return storage.getStore() as Ctx | undefined;
}
