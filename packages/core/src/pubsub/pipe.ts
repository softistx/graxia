// biome-ignore-all format: the overloads are generated, one per line
/**
 * Applies the operators to `source` from left to right, as Yoga's `pipe`:
 * `pipe(a, f, g)` is `g(f(a))`. Typed up to 19 operators, with no untyped
 * fallback: a mistyped operator is an error on that operator.
 *
 * @example
 * pipe(pubsub.subscribe('post', id), filter((p) => p.published), map((p) => p.title))
 */
export function pipe<A>(a: A): A;
export function pipe<A, B>(a: A, ab: (value: A) => B): B;
export function pipe<A, B, C>(a: A, ab: (value: A) => B, bc: (value: B) => C): C;
export function pipe<A, B, C, D>(a: A, ab: (value: A) => B, bc: (value: B) => C, cd: (value: C) => D): D;
export function pipe<A, B, C, D, E>(a: A, ab: (value: A) => B, bc: (value: B) => C, cd: (value: C) => D, de: (value: D) => E): E;
export function pipe<A, B, C, D, E, F>(a: A, ab: (value: A) => B, bc: (value: B) => C, cd: (value: C) => D, de: (value: D) => E, ef: (value: E) => F): F;
export function pipe<A, B, C, D, E, F, G>(a: A, ab: (value: A) => B, bc: (value: B) => C, cd: (value: C) => D, de: (value: D) => E, ef: (value: E) => F, fg: (value: F) => G): G;
export function pipe<A, B, C, D, E, F, G, H>(a: A, ab: (value: A) => B, bc: (value: B) => C, cd: (value: C) => D, de: (value: D) => E, ef: (value: E) => F, fg: (value: F) => G, gh: (value: G) => H): H;
export function pipe<A, B, C, D, E, F, G, H, I>(a: A, ab: (value: A) => B, bc: (value: B) => C, cd: (value: C) => D, de: (value: D) => E, ef: (value: E) => F, fg: (value: F) => G, gh: (value: G) => H, hi: (value: H) => I): I;
export function pipe<A, B, C, D, E, F, G, H, I, J>(a: A, ab: (value: A) => B, bc: (value: B) => C, cd: (value: C) => D, de: (value: D) => E, ef: (value: E) => F, fg: (value: F) => G, gh: (value: G) => H, hi: (value: H) => I, ij: (value: I) => J): J;
export function pipe<A, B, C, D, E, F, G, H, I, J, K>(a: A, ab: (value: A) => B, bc: (value: B) => C, cd: (value: C) => D, de: (value: D) => E, ef: (value: E) => F, fg: (value: F) => G, gh: (value: G) => H, hi: (value: H) => I, ij: (value: I) => J, jk: (value: J) => K): K;
export function pipe<A, B, C, D, E, F, G, H, I, J, K, L>(a: A, ab: (value: A) => B, bc: (value: B) => C, cd: (value: C) => D, de: (value: D) => E, ef: (value: E) => F, fg: (value: F) => G, gh: (value: G) => H, hi: (value: H) => I, ij: (value: I) => J, jk: (value: J) => K, kl: (value: K) => L): L;
export function pipe<A, B, C, D, E, F, G, H, I, J, K, L, M>(a: A, ab: (value: A) => B, bc: (value: B) => C, cd: (value: C) => D, de: (value: D) => E, ef: (value: E) => F, fg: (value: F) => G, gh: (value: G) => H, hi: (value: H) => I, ij: (value: I) => J, jk: (value: J) => K, kl: (value: K) => L, lm: (value: L) => M): M;
export function pipe<A, B, C, D, E, F, G, H, I, J, K, L, M, N>(a: A, ab: (value: A) => B, bc: (value: B) => C, cd: (value: C) => D, de: (value: D) => E, ef: (value: E) => F, fg: (value: F) => G, gh: (value: G) => H, hi: (value: H) => I, ij: (value: I) => J, jk: (value: J) => K, kl: (value: K) => L, lm: (value: L) => M, mn: (value: M) => N): N;
export function pipe<A, B, C, D, E, F, G, H, I, J, K, L, M, N, O>(a: A, ab: (value: A) => B, bc: (value: B) => C, cd: (value: C) => D, de: (value: D) => E, ef: (value: E) => F, fg: (value: F) => G, gh: (value: G) => H, hi: (value: H) => I, ij: (value: I) => J, jk: (value: J) => K, kl: (value: K) => L, lm: (value: L) => M, mn: (value: M) => N, no: (value: N) => O): O;
export function pipe<A, B, C, D, E, F, G, H, I, J, K, L, M, N, O, P>(a: A, ab: (value: A) => B, bc: (value: B) => C, cd: (value: C) => D, de: (value: D) => E, ef: (value: E) => F, fg: (value: F) => G, gh: (value: G) => H, hi: (value: H) => I, ij: (value: I) => J, jk: (value: J) => K, kl: (value: K) => L, lm: (value: L) => M, mn: (value: M) => N, no: (value: N) => O, op: (value: O) => P): P;
export function pipe<A, B, C, D, E, F, G, H, I, J, K, L, M, N, O, P, Q>(a: A, ab: (value: A) => B, bc: (value: B) => C, cd: (value: C) => D, de: (value: D) => E, ef: (value: E) => F, fg: (value: F) => G, gh: (value: G) => H, hi: (value: H) => I, ij: (value: I) => J, jk: (value: J) => K, kl: (value: K) => L, lm: (value: L) => M, mn: (value: M) => N, no: (value: N) => O, op: (value: O) => P, pq: (value: P) => Q): Q;
export function pipe<A, B, C, D, E, F, G, H, I, J, K, L, M, N, O, P, Q, R>(a: A, ab: (value: A) => B, bc: (value: B) => C, cd: (value: C) => D, de: (value: D) => E, ef: (value: E) => F, fg: (value: F) => G, gh: (value: G) => H, hi: (value: H) => I, ij: (value: I) => J, jk: (value: J) => K, kl: (value: K) => L, lm: (value: L) => M, mn: (value: M) => N, no: (value: N) => O, op: (value: O) => P, pq: (value: P) => Q, qr: (value: Q) => R): R;
export function pipe<A, B, C, D, E, F, G, H, I, J, K, L, M, N, O, P, Q, R, S>(a: A, ab: (value: A) => B, bc: (value: B) => C, cd: (value: C) => D, de: (value: D) => E, ef: (value: E) => F, fg: (value: F) => G, gh: (value: G) => H, hi: (value: H) => I, ij: (value: I) => J, jk: (value: J) => K, kl: (value: K) => L, lm: (value: L) => M, mn: (value: M) => N, no: (value: N) => O, op: (value: O) => P, pq: (value: P) => Q, qr: (value: Q) => R, rs: (value: R) => S): S;
export function pipe<A, B, C, D, E, F, G, H, I, J, K, L, M, N, O, P, Q, R, S, T>(a: A, ab: (value: A) => B, bc: (value: B) => C, cd: (value: C) => D, de: (value: D) => E, ef: (value: E) => F, fg: (value: F) => G, gh: (value: G) => H, hi: (value: H) => I, ij: (value: I) => J, jk: (value: J) => K, kl: (value: K) => L, lm: (value: L) => M, mn: (value: M) => N, no: (value: N) => O, op: (value: O) => P, pq: (value: P) => Q, qr: (value: Q) => R, rs: (value: R) => S, st: (value: S) => T): T;
export function pipe(
	source: unknown,
	...operators: ((value: never) => unknown)[]
): unknown {
	return operators.reduce(
		(value, operator) => operator(value as never),
		source,
	);
}
