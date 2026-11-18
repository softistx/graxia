/** What a limit answers: whether the units were let through, and when to retry (milliseconds). */
export interface FieldDecision {
	readonly allowed: boolean;
	/** Milliseconds until a refused call may succeed; `0` when allowed. */
	readonly retryAfter: number;
}

/** A counter of units per key, the one thing `fieldRateLimit` asks of a store. */
export interface FieldLimit {
	/** Spends `cost` units on `key`: allowed, or refused with the time to wait. */
	consume(key: string, cost: number): FieldDecision | Promise<FieldDecision>;
}

/** A limit, or a limit with the field's own rules. */
export type FieldRule =
	| FieldLimit
	| {
			readonly limit: FieldLimit;
			/** The field may be selected once per operation (a second selection is refused with a 400). */
			readonly single?: boolean;
	  };

/** Options of {@link fieldRateLimit}. */
export interface FieldRateLimitOptions<Ctx extends object = any> {
	/** The limit of each field, by field name, wherever the field is selected (any depth, any type). */
	readonly fields: Readonly<Record<string, FieldRule>>;
	/**
	 * Who is counted. Default: `ctx.ip` when the context has a string `ip`, else
	 * the address `serve()` read from the connection. `undefined` counts nothing.
	 */
	readonly key?: (ctx: Ctx) => string | undefined | Promise<string | undefined>;
	/** Counts an IPv6 client by its network (the first `ipv6Prefix` bits, 0 to 128). Default key only. */
	readonly ipv6Prefix?: number;
	/** The `extensions.code` of a refusal. `RATE_LIMITED` by default. */
	readonly code?: string;
}

/** A store that takes the cost one unit at a time, such as a request rate limiter. */
export interface CostlessStore {
	consume(
		key: string,
		policy: { limit: number; windowMs: number },
	):
		| { allowed: boolean; retryAfter: number }
		| Promise<{ allowed: boolean; retryAfter: number }>;
	/** The policy the store already applies. */
	readonly policy?: { limit: number; windowMs: number };
}

/** The default `extensions.code` of a refusal. */
export const DEFAULT_LIMIT_CODE = 'RATE_LIMITED';
