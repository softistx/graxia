import { createRequire } from 'node:module';

/**
 * The part of `@opentelemetry/api` graxia uses, described structurally so
 * the published declarations never import the optional peer. The real
 * `Tracer`, `Span`, `trace`, `context` and `propagation` satisfy it.
 */
export interface SpanLike {
	setAttribute(key: string, value: string | number | boolean): unknown;
	addEvent(name: string, attributes?: Record<string, string | number>): unknown;
	setStatus(status: { code: number; message?: string }): unknown;
	recordException(exception: unknown): unknown;
	updateName(name: string): unknown;
	end(): void;
}

/** A tracer, as `trace.getTracer()` returns it. */
export interface TracerLike {
	startSpan(
		name: string,
		options?: { kind?: number; attributes?: Record<string, string | number> },
		context?: any,
	): SpanLike;
}

/** The module `@opentelemetry/api`, as far as graxia reads it. */
export interface OtelApi {
	trace: {
		getTracer(name: string, version?: string): TracerLike;
		setSpan(context: any, span: any): any;
		getActiveSpan(): unknown;
	};
	context: {
		active(): any;
		with<T>(context: any, fn: () => T): T;
	};
	propagation: {
		extract(context: any, carrier: Headers, getter: HeaderGetter): any;
	};
	SpanKind: { SERVER: number; INTERNAL: number };
	SpanStatusCode: { ERROR: number };
}

/** Reads W3C trace context headers from a Web `Headers`. */
export interface HeaderGetter {
	keys(carrier: Headers): string[];
	get(carrier: Headers, key: string): string | undefined;
}

/** @internal Reads the headers `propagation.extract` asks for. */
export const headerGetter: HeaderGetter = {
	keys: (carrier) => [...carrier.keys()],
	get: (carrier, key) => carrier.get(key) ?? undefined,
};

/** @internal Loads `@opentelemetry/api`, or `undefined` when it is not installed. */
export type ApiLoader = () => OtelApi | undefined;

const PACKAGE = '@opentelemetry/api';

/** @internal The loader `createGraxia` uses. Specs replace `load` to simulate a missing peer. */
export const apiLoader: { load: ApiLoader } = { load: () => loadApi() };

/** @internal The default loader: a synchronous `require` of the optional peer, never a hard dependency. */
export const loadApi: ApiLoader = () => {
	try {
		return createRequire(import.meta.url)(PACKAGE) as OtelApi;
	} catch {
		return undefined;
	}
};
