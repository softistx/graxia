import { createStateKey, type RequestState } from '../plugins/state';
import type {
	HostScope,
	SpanLike,
	StartOptions,
	TelemetryApi,
	TelemetryInstance,
} from './api';

/** Span and attribute names graxia emits (OpenTelemetry GraphQL conventions where they exist, `graxia.*` otherwise). */
export const SPAN = {
	request: 'graphql.request',
	operation: 'graphql.operation',
	parse: 'graphql.parse',
	validate: 'graphql.validate',
	resolve: 'graphql.resolve',
	error: 'graphql.error',
} as const;

/** The attribute and event names of the spans. */
export const ATTR = {
	httpMethod: 'http.request.method',
	httpStatus: 'http.response.status_code',
	requestId: 'graxia.request.id',
	upgrade: 'graxia.request.upgrade',
	refusalCode: 'graxia.refusal.code',
	operationType: 'graphql.operation.type',
	operationName: 'graphql.operation.name',
	document: 'graphql.document',
	documentId: 'graxia.document.id',
	errorCount: 'graphql.error.count',
	events: 'graxia.events',
	cacheHit: 'graxia.cache.hit',
	fieldName: 'graphql.field.name',
	fieldPath: 'graphql.field.path',
	fieldType: 'graphql.field.type',
	parentType: 'graphql.parent.type',
} as const;

/** The name of the span event added for each payload of a subscription or incremental result. */
export const EVENT_NAME = 'graphql.event';

/** What the spans need: the API, the optional telemetry instance and the resolved options. */
export interface Env {
	api: TelemetryApi;
	instance: TelemetryInstance | undefined;
	operationSpans: boolean;
	document: boolean;
	propagate: boolean;
}

/** A started span (a handle that outlives the function that opened it). */
export type Live = SpanLike;

/** @internal The request span of an HTTP request, and the streams that keep it open. */
export const requestKey = createStateKey<{
	live: Live;
	held: Promise<unknown>[];
}>('graxia.telemetry.request');
/** @internal The span an operation is parented to when there is no request span in its state (a WebSocket: the upgrade's). */
export const parentKey = createStateKey<Live>('graxia.telemetry.parent');
/** @internal The operation span of the operation a state belongs to. */
export const operationKey = createStateKey<Operation>(
	'graxia.telemetry.operation',
);

/** @internal Set when the request span is not recording (no SDK, or sampled out): the rest of the request is untraced. */
export const quietKey = createStateKey<true>('graxia.telemetry.quiet');

/** @internal The host's active span at the request (`operationSpans: false`): the operation's attributes go on it, and spans started with no active span (a socket's) continue its trace. */
export const hostKey = createStateKey<{
	scope: HostScope;
	/** A WebSocket's upgrade: its operations write nothing to the host span. */
	upgrade: boolean;
}>('graxia.telemetry.host');

/** @internal Set on the state of each entry of a batch: a batch writes nothing to the host span. */
export const batchedKey = createStateKey<true>('graxia.telemetry.batched');

/** @internal Causes a resolver span already recorded, so the host stand-in does not record them again. */
export const recorded = new WeakSet<object>();

/** @internal The operation span of an operation the host spans: a {@link Live} that writes to the host's span and carries its `traceparent`. */
export type StandIn = Live & { traceparent?: string };

/** @internal The state of an operation span. */
export interface Operation {
	live: Live;
	errors: number;
	events: number;
	ended: boolean;
	/** Set when the operation has no span of its own (`operationSpans: false`): what its validate span carries (the host's span gets them too, for a single HTTP operation). `live` is a stand-in for the host's span, never renamed or ended. */
	standIn?: Record<string, string | number>;
}

/** Starts a span under `parent` (else under the active one, else a new trace). */
export function start(
	env: Env,
	name: string,
	parent: Live | undefined,
	options: StartOptions,
): Live {
	const carried = (parent as StandIn | undefined)?.traceparent;
	const open = () =>
		env.api.startSpan(
			name,
			carried && env.api.currentSpan() === undefined
				? { ...options, traceparent: carried }
				: options,
		);
	const within = () =>
		env.instance ? env.api.withTelemetry(env.instance, open) : open();
	return parent ? parent.run(within) : within();
}

/** Records `error` on `span` and marks it failed. */
export function fail(span: Live, error: unknown): void {
	span.fail(error);
}

/** The span a new span of this state hangs under. */
export function parentOf(state: RequestState): Live | undefined {
	return (
		state.get(operationKey)?.live ??
		state.get(requestKey)?.live ??
		state.get(parentKey)
	);
}

/** The persisted document id a request named (`documentId`, else an APQ hash). */
export function documentIdOf(params: {
	documentId?: string | undefined;
	extensions?: Record<string, unknown> | undefined;
}): string | undefined {
	if (typeof params.documentId === 'string') return params.documentId;
	const hash = (
		params.extensions?.['persistedQuery'] as { sha256Hash?: unknown }
	)?.sha256Hash;
	return typeof hash === 'string' ? hash : undefined;
}
