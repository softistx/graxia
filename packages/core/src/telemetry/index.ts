import type { GraphQLSchema, OperationDefinitionNode } from 'graphql';
import type { RequestState } from '../plugins/state';
import type { GraphQLParams } from '../plugins/types';
import type { Outcome } from '../server/outcome';
import { type ApiLoader, apiLoader } from './api';
import { resolveTelemetry, type TelemetryOptions } from './options';
import { traceRequest } from './request';
import { wrapSchemaResolvers } from './resolvers';
import { type Env, requestKey } from './spans';
import {
	describeOperation,
	type StepLike,
	traceOperation,
	traceScope,
	traceStep,
} from './steps';

export type { TelemetryInstance } from './api';
export type { TelemetryOptions } from './options';

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

/** @internal The tracing hooks for `options`, or the off implementation (`telemetry: false`, or no `@softistx/telemetry`). */
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
		instance: resolved.instance,
		document: resolved.document,
		propagate: resolved.propagate,
	};
	const trivial = resolved.resolvers ? resolved.resolvers.trivial : undefined;
	if (trivial !== undefined) wrapSchemaResolvers(schema, trivial);
	return {
		on: true,
		request: (request, state, run) =>
			traceRequest(env, request, state, run, false),
		upgrade: (request, state, run) =>
			traceRequest(env, request, state, run, true),
		hold: (state, done) => void state.get(requestKey)?.held.push(done),
		operation: (state, run) => traceOperation(env, schema, state, run),
		describe: (state, info) => describeOperation(env, state, info),
		step: (state, name, run) => traceStep(env, state, name, run),
		scope: (state, contextValue, scope) =>
			traceScope(env, trivial, state, contextValue, scope),
	};
}
