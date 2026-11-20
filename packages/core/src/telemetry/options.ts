import { GraxiaConfigError } from '../errors/config-error';
import type { TelemetryInstance } from './api';

/** The `telemetry` option of `createGraxia`: spans on `@softistx/telemetry`. */
export interface TelemetryOptions {
	/**
	 * The `Telemetry` (from `createTelemetry`) that receives the spans. Default: the one in scope
	 * or installed (`createTelemetry(...).install()`). Without either, spans are detached no-ops.
	 */
	instance?: TelemetryInstance;
	/**
	 * One span per resolver call (`graphql.resolve <field>`). `false` by default: it costs a span
	 * per field. `true` traces resolvers you wrote; `{ trivial: true }` also traces fields with no
	 * resolver (graphql's default one). Resolvers are wrapped once, in place, on the schema.
	 */
	resolverSpans?: boolean | { trivial?: boolean };
	/**
	 * `graphql.request` and operation spans. `true` by default. `false` for a host that already
	 * spans the request and the operation: graxia then drops both and keeps its parse, validate
	 * and resolver spans, parented under the host's active span (a socket's operations continue
	 * the host's trace from its upgrade). The operation's type, name, document id and, with
	 * `document`, source go on the validate span, and the cause of a masked error becomes a failed
	 * `graphql.error` span. With no active host span at the request there is nothing to
	 * duplicate: graxia makes its spans as usual, and `propagate` keeps its meaning.
	 */
	operationSpans?: boolean;
	/** Puts the document source in `graphql.document` on the operation span (on the validate span when the host spans the operation, see `operationSpans`). `false` by default: it may hold literals. */
	document?: boolean;
	/** Reads W3C trace context (`traceparent`) from the request headers when no span is active. `true` by default. */
	propagate?: boolean;
}

/** @internal {@link TelemetryOptions} with defaults applied. */
export interface ResolvedTelemetry {
	instance: TelemetryInstance | undefined;
	resolvers: false | { trivial: boolean };
	operationSpans: boolean;
	document: boolean;
	propagate: boolean;
}

const bad = (message: string) => new GraxiaConfigError(message);

/** @internal Validates `telemetry` and applies the defaults; `undefined` when it is `false`. */
export function resolveTelemetry(
	option: false | TelemetryOptions | undefined,
): ResolvedTelemetry | undefined {
	if (option === false) return undefined;
	if (option === undefined) option = {};
	if (typeof option !== 'object' || option === null || Array.isArray(option))
		throw bad('telemetry must be false or an object');
	if ('tracer' in option)
		throw bad(
			'telemetry.tracer was replaced by telemetry.instance (a Telemetry from createTelemetry in @softistx/telemetry); see the telemetry migration guide',
		);
	const { instance, resolverSpans, operationSpans, document, propagate } =
		option;
	if (
		instance !== undefined &&
		(typeof instance !== 'object' ||
			instance === null ||
			typeof (instance as { emit?: unknown }).emit !== 'function')
	)
		throw bad('telemetry.instance must be a @softistx/telemetry Telemetry');
	for (const [name, value] of [
		['operationSpans', operationSpans],
		['document', document],
		['propagate', propagate],
	] as const)
		if (value !== undefined && typeof value !== 'boolean')
			throw bad(`telemetry.${name} must be a boolean`);
	const trivial =
		typeof resolverSpans === 'object' && resolverSpans !== null
			? resolverSpans.trivial
			: undefined;
	if (
		resolverSpans !== undefined &&
		typeof resolverSpans !== 'boolean' &&
		(typeof resolverSpans !== 'object' ||
			resolverSpans === null ||
			(trivial !== undefined && typeof trivial !== 'boolean'))
	)
		throw bad(
			'telemetry.resolverSpans must be a boolean or { trivial?: boolean }',
		);
	return {
		instance,
		resolvers:
			resolverSpans === undefined || resolverSpans === false
				? false
				: { trivial: trivial === true },
		operationSpans: operationSpans !== false,
		document: document === true,
		propagate: propagate !== false,
	};
}
