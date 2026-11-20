import { createStateKey, type RequestState } from '@graxia/core';
import type { Op } from './types';

/** The per-operation record of one adapter (a key per `fromEnvelop` call). */
export const opKey = () => createStateKey<Op>('envelop');

/**
 * The Envelop context of this operation, created on first use:
 * `{ request, params }` first, then what the hooks run before `onContext`
 * (`onEnveloped`, `onParse`, `onValidate`) extend it with.
 */
export function opOf(
	key: ReturnType<typeof opKey>,
	state: RequestState,
	seed: { request: Request; params: unknown },
): Op {
	const known = state.get(key);
	if (known) return known;
	const op: Op = {
		context: { request: seed.request, params: seed.params },
		extended: new Set(),
	};
	state.set(key, op);
	return op;
}

/** `extendContext` of the early hooks: merges into the context and remembers the keys. */
export function extender(op: Op): (extension: object) => void {
	return (extension) => {
		Object.assign(op.context, extension);
		for (const key of Reflect.ownKeys(extension)) op.extended.add(key);
	};
}
