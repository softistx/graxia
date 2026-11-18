import { GraxiaConfigError } from '../errors/config-error';
import type { CostlessStore, FieldDecision, FieldLimit } from './types';

const positive = (value: unknown): value is number =>
	typeof value === 'number' && Number.isInteger(value) && value >= 1;

function need(owner: string, name: string, value: unknown): number {
	if (positive(value)) return value;
	throw new GraxiaConfigError(
		`${owner}: ${name} must be an integer of 1 or more`,
	);
}

/**
 * A limit over a store that counts one request per call (a request rate
 * limiter): a cost of 3 is three `store.consume` calls, stopped at the first
 * refusal. The policy comes from the store, from `policy`, or both when they agree.
 * @throws {GraxiaConfigError} when the policy is missing, invalid or differs from the store's.
 */
export function limitFromStore(
	store: CostlessStore,
	policy: { limit?: number; windowMs?: number } = {},
): FieldLimit {
	const merge = (name: 'limit' | 'windowMs'): number => {
		const own = policy[name];
		const theirs = store.policy?.[name];
		if (own !== undefined && theirs !== undefined && own !== theirs)
			throw new GraxiaConfigError(
				`limitFromStore: ${name} ${own} differs from the store policy's ${name} ${theirs}`,
			);
		const value = own ?? theirs;
		if (value === undefined)
			throw new GraxiaConfigError(
				'limitFromStore: no policy; pass { limit, windowMs } or give the store a policy',
			);
		return need('limitFromStore', name, value);
	};
	const resolved = { limit: merge('limit'), windowMs: merge('windowMs') };
	return {
		async consume(key, cost) {
			// A cost over the limit can never pass: one call tells how long to wait.
			if (!Number.isFinite(cost) || cost > resolved.limit) {
				const decision = Number.isFinite(cost)
					? await store.consume(key, resolved)
					: { allowed: true, retryAfter: 0 };
				return {
					allowed: false,
					retryAfter: decision.allowed
						? resolved.windowMs
						: decision.retryAfter,
				};
			}
			for (let unit = 0; unit < cost; unit++) {
				const decision = await store.consume(key, resolved);
				if (!decision.allowed)
					return { allowed: false, retryAfter: decision.retryAfter };
			}
			return { allowed: true, retryAfter: 0 };
		},
	};
}

/** Options of {@link memoryFieldLimit}. */
export interface MemoryFieldLimitOptions {
	/** Units allowed per key and window. */
	limit: number;
	/** The window in milliseconds. */
	windowMs: number;
	/** The most keys kept; expired ones go first, then the oldest. 10 000 by default. */
	maxKeys?: number;
	/** The clock, in milliseconds. `Date.now` by default; set it in tests. */
	now?: () => number;
}

/**
 * A fixed-window limit in memory, for one process (development, tests, a single
 * server). A call over the remaining units is refused and spends nothing.
 * @throws {GraxiaConfigError} when `limit`, `windowMs` or `maxKeys` is not an integer of 1 or more.
 */
export function memoryFieldLimit(options: MemoryFieldLimitOptions): FieldLimit {
	const limit = need('memoryFieldLimit', 'limit', options?.limit);
	const windowMs = need('memoryFieldLimit', 'windowMs', options.windowMs);
	const maxKeys = need(
		'memoryFieldLimit',
		'maxKeys',
		options.maxKeys ?? 10_000,
	);
	const now = options.now ?? Date.now;
	const windows = new Map<string, { used: number; resetAt: number }>();
	let swept = 0;
	const make = (key: string, at: number) => {
		if (windows.size >= maxKeys) {
			// Expired entries go at most once per window; otherwise only the oldest entry.
			if (at - swept >= windowMs) {
				swept = at;
				for (const [k, w] of windows) if (w.resetAt <= at) windows.delete(k);
			}
			if (windows.size >= maxKeys)
				windows.delete(windows.keys().next().value as string);
		}
		const fresh = { used: 0, resetAt: at + windowMs };
		windows.set(key, fresh);
		return fresh;
	};
	return {
		consume(key, cost): FieldDecision {
			const at = now();
			let window = windows.get(key);
			if (!window || window.resetAt <= at) {
				windows.delete(key);
				window = make(key, at);
			}
			if (window.used + cost > limit)
				return { allowed: false, retryAfter: window.resetAt - at };
			window.used += cost;
			return { allowed: true, retryAfter: 0 };
		},
	};
}
