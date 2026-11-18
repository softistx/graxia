import { GraxiaConfigError } from '../errors/config-error';
import type { TracerLike } from './api';

/** The `telemetry` option of `createGraxia`: OpenTelemetry spans. */
export interface TelemetryOptions {
	/** The tracer to use. Default: `trace.getTracer('@graxia/core')`. */
	tracer?: TracerLike;
	/**
	 * One span per resolver call (`graphql.resolve <field>`). `false` by default: it costs a span
	 * per field. `true` traces resolvers you wrote; `{ trivial: true }` also traces fields with no
	 * resolver (graphql's default one). Resolvers are wrapped once, in place, on the schema.
	 */
	resolverSpans?: boolean | { trivial?: boolean };
	/** Puts the document source in `graphql.document` on the operation span. `false` by default: it may hold literals. */
	document?: boolean;
	/** Reads W3C trace context (`traceparent`) from the request headers when no span is active. `true` by default. */
	propagate?: boolean;
}

/** @internal {@link TelemetryOptions} with defaults applied. */
export interface ResolvedTelemetry {
	tracer: TracerLike | undefined;
	resolvers: false | { trivial: boolean };
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
	const { tracer, resolverSpans, document, propagate } = option;
	if (
		tracer !== undefined &&
		(typeof tracer !== 'object' ||
			tracer === null ||
			typeof tracer.startSpan !== 'function')
	)
		throw bad('telemetry.tracer must be an OpenTelemetry Tracer');
	for (const [name, value] of [
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
		tracer,
		resolvers:
			resolverSpans === undefined || resolverSpans === false
				? false
				: { trivial: trivial === true },
		document: document === true,
		propagate: propagate !== false,
	};
}
