import type {
	DocumentNode,
	ExecutionArgs,
	GraphQLError,
	GraphQLSchema,
	ValidationRule,
} from 'graphql';
import type { StageRunner } from '../stage';
import type { RequestState } from '../state';
import type {
	ExecuteFn,
	ExecutionOutput,
	GraphQLParams,
	OnExecuteDone,
	OnParamsDone,
	OnParamsInput,
	OnParseDone,
	OnRequestDone,
	OnValidateDone,
	ParseFn,
	ValidationFn,
} from '../types';

/** Fields every stage input carries. */
export interface Base {
	request: Request;
	state: RequestState;
}

/** The host context, carried by the stages whose payload shows it. */
export interface Host {
	serverContext: Readonly<Record<string, unknown>>;
}

/** Decisions collected by the `onRequest` stage. */
export interface RequestOut {
	response?: Response;
}
/** Decisions collected by the `onParams` stage. */
export interface ParamsOut {
	params: GraphQLParams;
	response?: Response;
}
/** Decisions collected by the `onParse` stage. */
export interface ParseOut {
	parseFn?: ParseFn;
	document?: DocumentNode;
}
/** Decisions collected by the `onValidate` stage. */
export interface ValidateOut {
	validationFn?: ValidationFn;
	rules: ValidationRule[];
	errors?: readonly GraphQLError[];
}
/** Decisions collected by the `onContext` stage: the merged context. */
export interface ContextOut {
	context: Record<string, unknown>;
}
/** Decisions collected by `onExecute` / `onSubscribe`. */
export interface ExecuteOut {
	executeFn?: ExecuteFn;
	result?: ExecutionOutput;
}
/** Decisions collected by the `onResultChunk` stage. */
export interface ChunkOut {
	chunk: unknown;
}
/** Decisions collected by the `onResponse` stage. */
export interface ResponseOut {
	response: Response;
}

/**
 * One runner per lifecycle stage. Each takes the stage input (the request,
 * its state and the stage data) and resolves to `{ out, runAfter }`: `out`
 * holds what the hooks decided (a short-circuit response, a replaced
 * function, the merged context…) and `runAfter(done)` runs the after-hooks of
 * the hooks that ran, in reverse order.
 *
 * A runner never rejects for a hook error: it returns `{ out, error?, runAfter }`.
 * Hooks after the thrower are skipped, `error` is the original thrown value
 * (unwrapped), and `runAfter(done)` still unwinds the after-hooks of the hooks
 * that ran before it. The caller decides what to do with `error`.
 *
 * Setters other than `respond` (`setResult`, `setDocument`, `setParseFn`,
 * `setValidationFn`, `setParams`, `setChunk`, `setResponse`) do not stop the
 * stage: later hooks still run, the last write wins, and the caller skips the
 * step when `out.document`, `out.errors` or `out.result` is set.
 */
export interface PluginRunners {
	onRequest: StageRunner<Base & Host, RequestOut, OnRequestDone>;
	onParams: StageRunner<Base & OnParamsInput, ParamsOut, OnParamsDone>;
	onParse: StageRunner<
		Base & Host & { params: GraphQLParams },
		ParseOut,
		OnParseDone
	>;
	onValidate: StageRunner<
		Base & Host & { schema: GraphQLSchema; document: DocumentNode },
		ValidateOut,
		OnValidateDone
	>;
	onContext: StageRunner<
		Base & { context: Record<string, unknown> },
		ContextOut,
		void
	>;
	onExecute: StageRunner<
		Base & { args: ExecutionArgs; fallback?: ExecuteFn },
		ExecuteOut,
		OnExecuteDone
	>;
	onSubscribe: StageRunner<
		Base & { args: ExecutionArgs; fallback?: ExecuteFn },
		ExecuteOut,
		OnExecuteDone
	>;
	onResultChunk: StageRunner<Base & { chunk: unknown }, ChunkOut, void>;
	onResponse: StageRunner<Base & { response: Response }, ResponseOut, void>;
}
