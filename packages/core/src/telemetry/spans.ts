import { createStateKey } from '../plugins/state';
import type { OtelApi, SpanLike, TracerLike } from './api';

/** Span and attribute names graxia emits (OpenTelemetry GraphQL conventions where they exist, `graxia.*` otherwise). */
export const SPAN = {
	request: 'graphql.request',
	operation: 'graphql.operation',
	parse: 'graphql.parse',
	validate: 'graphql.validate',
	resolve: 'graphql.resolve',
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

/** What the spans need: the API, the tracer and the resolved options. */
export interface Env {
	api: OtelApi;
	tracer: TracerLike;
	document: boolean;
	propagate: boolean;
}

/** A started span and the context that has it active. */
export interface Live {
	span: SpanLike;
	ctx: any;
}

/** @internal The request span of an HTTP request, and the streams that keep it open. */
export const requestKey = createStateKey<{
	live: Live;
	held: Promise<unknown>[];
}>('graxia.telemetry.request');
/** @internal The context an operation is parented to when there is no request span (a WebSocket). */
export const parentKey = createStateKey<any>('graxia.telemetry.parent');
/** @internal The operation span of the operation a state belongs to. */
export const operationKey = createStateKey<Operation>(
	'graxia.telemetry.operation',
);

/** @internal Set when the request span is not recording (no SDK, or sampled out): the rest of the request is untraced. */
export const quietKey = createStateKey<true>('graxia.telemetry.quiet');

/** @internal The state of an operation span. */
export interface Operation {
	live: Live;
	errors: number;
	events: number;
	ended: boolean;
}

export function start(
	env: Env,
	name: string,
	kind: number,
	parent: any,
	attributes?: Record<string, string | number>,
): Live {
	const span = env.tracer.startSpan(
		name,
		{ kind, ...(attributes ? { attributes } : {}) },
		parent,
	);
	return { span, ctx: env.api.trace.setSpan(parent, span) };
}

/** Records `error` on `span` and marks it failed. */
export function fail(env: Env, span: SpanLike, error: unknown): void {
	span.recordException(error instanceof Error ? error : String(error));
	span.setStatus({
		code: env.api.SpanStatusCode.ERROR,
		message: error instanceof Error ? error.message : String(error),
	});
}

/** The context a span of this state hangs under. */
export function parentOf(
	env: Env,
	state: import('../plugins/state').RequestState,
) {
	return (
		state.get(operationKey)?.live.ctx ??
		state.get(requestKey)?.live.ctx ??
		state.get(parentKey) ??
		env.api.context.active()
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
