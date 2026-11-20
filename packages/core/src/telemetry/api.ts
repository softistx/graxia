import { createRequire } from 'node:module';

/**
 * The part of `@softistx/telemetry` graxia uses, described structurally so
 * the published declarations never import the optional peer. The real
 * `startSpan`, `currentSpan` and `withTelemetry` satisfy it.
 */
export interface SpanLike {
	/** Writable: the operation span is renamed once the operation is chosen. */
	name: string;
	/** Writable: `'error'` marks a failure that was not thrown (a 5xx answer). */
	status: 'ok' | 'error' | 'cancelled';
	/** `sampled` is false for a detached span (nothing installed) and for a sampled-out trace. */
	readonly context: { readonly sampled: boolean };
	attribute(name: string, value: unknown): void;
	event(name: string, attributes?: Record<string, unknown>): void;
	fail(failure: unknown): void;
	/** Ends and emits the span; idempotent. */
	end(): void;
	/** Runs `fn` with this span current, so spans started inside are its children. */
	run<T>(fn: () => T): T;
}

/**
 * A `Telemetry` from `createTelemetry` in `@softistx/telemetry`, described structurally so
 * the published declarations never import the optional peer.
 */
export interface TelemetryInstance {
	emit(signal: never): unknown;
	flush(): Promise<void>;
}

/** The options `startSpan` takes that graxia sets. */
export interface StartOptions {
	kind: 'internal' | 'server';
	attributes?: Record<string, string | number>;
	traceparent?: string | null;
}

/** The module `@softistx/telemetry`, as far as graxia reads it. */
export interface TelemetryApi {
	startSpan(name: string, options?: StartOptions): SpanLike;
	currentSpan(): unknown;
	currentTraceparent(): string | undefined;
	withTelemetry<T>(telemetry: TelemetryInstance, fn: () => T): T;
}

/** @internal Loads `@softistx/telemetry`, or `undefined` when it is not installed. */
export type ApiLoader = () => TelemetryApi | undefined;

const PACKAGE = '@softistx/telemetry';

/** @internal The loader `createGraxia` uses. Specs replace `load` to simulate a missing peer. */
export const apiLoader: { load: ApiLoader } = { load: () => loadApi() };

/** @internal The default loader: a synchronous `require` of the optional peer, never a hard dependency. */
export const loadApi: ApiLoader = () => {
	try {
		return createRequire(import.meta.url)(PACKAGE) as TelemetryApi;
	} catch {
		return undefined;
	}
};
