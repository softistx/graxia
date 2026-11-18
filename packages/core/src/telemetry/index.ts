import type { GraphQLSchema, OperationDefinitionNode } from 'graphql';
import type { RequestState } from '../plugins/state';
import type { GraphQLParams } from '../plugins/types';
import type { Outcome } from '../server/outcome';
import { type ApiLoader, apiLoader } from './api';
import { settleOutcome } from './operation';
import { resolveTelemetry, type TelemetryOptions } from './options';
import { traceRequest } from './request';
import { bindResolvers, wrapSchemaResolvers } from './resolvers';
import {
	ATTR,
	documentIdOf,
	type Env,
	fail,
	type Operation,
	operationKey,
	parentOf,
	requestKey,
	SPAN,
	start,
} from './spans';

export type { TelemetryOptions } from './options';

/** @internal What a validation or parse step reports back to its span. */
export interface StepLike {
	errors?: readonly unknown[] | undefined;
	error?: unknown;
	cacheHit?: boolean | undefined;
}

/**
 * @internal The tracing hooks of the transport. The off implementation does
 * nothing and allocates nothing: call sites are one line.
 */
export interface Telemetry {
	/** Whether spans are made. */
	readonly on: boolean;
	/** Runs the handling of an HTTP request in a `graphql.request` span. */
	request(
		request: Request,
		state: RequestState,
		run: () => Promise<Response>,
	): Promise<Response>;
	/** Runs the WebSocket handshake in a short `graphql.request` span. */
	upgrade(
		request: Request,
		state: RequestState,
		run: () => Promise<Response | undefined>,
	): Promise<Response | undefined>;
	/** Keeps the request span open until `done` settles (a streamed response). */
	hold(state: RequestState, done: Promise<unknown>): void;
	/** Runs one operation in its span, which ends with the outcome (a stream: with the stream). */
	operation(state: RequestState, run: () => Promise<Outcome>): Promise<Outcome>;
	/** Names the operation span and sets its attributes once the operation is chosen. */
	describe(
		state: RequestState,
		info: {
			operation: OperationDefinitionNode;
			source: string;
			params: GraphQLParams;
		},
	): void;
	/** Runs the parse or validate step in a span of its own. */
	step<R extends StepLike>(
		state: RequestState,
		name: 'parse' | 'validate',
		run: () => Promise<R>,
	): Promise<R>;
	/** Makes `scope` run inside the operation span's context, and traces the resolvers of `contextValue`. */
	scope(
		state: RequestState,
		contextValue: object,
		scope: <T>(work: () => T) => T,
	): <T>(work: () => T) => T;
}

const OFF: Telemetry = {
	on: false,
	request: (_request, _state, run) => run(),
	upgrade: (_request, _state, run) => run(),
	hold: () => {},
	operation: (_state, run) => run(),
	describe: () => {},
	step: (_state, _name, run) => run(),
	scope: (_state, _contextValue, scope) => scope,
};

/** @internal The tracing hooks for `options`, or the off implementation (`telemetry: false`, or no `@opentelemetry/api`). */
export function createTelemetry(
	option: false | TelemetryOptions | undefined,
	schema: GraphQLSchema,
	loader: ApiLoader = () => apiLoader.load(),
): Telemetry {
	const resolved = resolveTelemetry(option);
	if (!resolved) return OFF;
	const api = loader();
	if (!api) return OFF;
	const env: Env = {
		api,
		tracer: resolved.tracer ?? api.trace.getTracer('@graxia/core'),
		document: resolved.document,
		propagate: resolved.propagate,
	};
	if (resolved.resolvers)
		wrapSchemaResolvers(schema, resolved.resolvers.trivial);
	const { INTERNAL } = api.SpanKind;
	return {
		on: true,
		request: (request, state, run) =>
			traceRequest(env, request, state, run, false),
		upgrade: (request, state, run) =>
			traceRequest(env, request, state, run, true),
		hold: (state, done) => void state.get(requestKey)?.held.push(done),
		async operation(state, run) {
			const live = start(env, SPAN.operation, INTERNAL, parentOf(env, state));
			const op: Operation = { live, errors: 0, events: 0, ended: false };
			state.set(operationKey, op);
			const inContext = <T>(work: () => T) => api.context.with(live.ctx, work);
			try {
				const outcome = await inContext(run);
				return settleOutcome(env, schema, op, outcome, inContext);
			} catch (error) {
				fail(env, live.span, error);
				live.span.end();
				op.ended = true;
				throw error;
			}
		},
		describe(state, { operation, source, params }) {
			const op = state.get(operationKey);
			if (!op) return;
			const name = operation.name?.value;
			op.live.span.updateName(
				name ? `${operation.operation} ${name}` : operation.operation,
			);
			op.live.span.setAttribute(ATTR.operationType, operation.operation);
			if (name) op.live.span.setAttribute(ATTR.operationName, name);
			if (env.document) op.live.span.setAttribute(ATTR.document, source);
			const id = documentIdOf(params);
			if (id) op.live.span.setAttribute(ATTR.documentId, id);
		},
		async step(state, name, run) {
			const live = start(
				env,
				name === 'parse' ? SPAN.parse : SPAN.validate,
				INTERNAL,
				parentOf(env, state),
			);
			try {
				const result = await run();
				if (result.cacheHit !== undefined)
					live.span.setAttribute(ATTR.cacheHit, result.cacheHit);
				if (result.errors?.length)
					live.span.setAttribute(ATTR.errorCount, result.errors.length);
				if (result.error !== undefined) fail(env, live.span, result.error);
				return result;
			} catch (error) {
				fail(env, live.span, error);
				throw error;
			} finally {
				live.span.end();
			}
		},
		scope(state, contextValue, scope) {
			const op = state.get(operationKey);
			if (!op) return scope;
			if (resolved.resolvers)
				bindResolvers(
					contextValue,
					env,
					op.live.ctx,
					resolved.resolvers.trivial,
				);
			return (work) => api.context.with(op.live.ctx, () => scope(work));
		},
	};
}
