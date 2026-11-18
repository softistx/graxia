import type {
	DocumentNode,
	ExecutionArgs,
	ExperimentalIncrementalExecutionResults,
	execute,
	GraphQLError,
	GraphQLSchema,
	LegacyExperimentalIncrementalExecutionResults,
	subscribe,
	ValidationRule,
} from 'graphql';
import type { RequestState } from './state';

/** The empty context: no keys. */
export type Empty = Record<never, never>;

/** A value or a promise of it. */
export type MaybePromise<T> = T | Promise<T>;

/** Lifecycle stages, in pipeline order. */
export type HookStage =
	| 'onRequest'
	| 'onParams'
	| 'onParse'
	| 'onValidate'
	| 'onContext'
	| 'onExecute'
	| 'onSubscribe'
	| 'onResultChunk'
	| 'onResponse';

/** What a hook may return: nothing, or an after-hook run in reverse order. */
export type HookReturn<Done> = MaybePromise<
	void | ((done: Done) => MaybePromise<void>)
>;

/** Result of `execute` or `subscribe` (single result or incremental/stream). */
export type ExecutionOutput =
	| Awaited<ReturnType<typeof execute>>
	| Awaited<ReturnType<typeof subscribe>>
	| ExperimentalIncrementalExecutionResults
	| LegacyExperimentalIncrementalExecutionResults;
/** A replaceable parse function. */
export type ParseFn = (source: string) => DocumentNode;
/** A replaceable validation function. */
export type ValidationFn = (
	schema: GraphQLSchema,
	document: DocumentNode,
	rules: readonly ValidationRule[],
) => readonly GraphQLError[];
/** A replaceable execute (or subscribe) function. */
export type ExecuteFn = (args: ExecutionArgs) => MaybePromise<ExecutionOutput>;

/** GraphQL request parameters, as parsed from the transport. */
export interface GraphQLParams {
	query?: string;
	/** A persisted document's id (GraphQL over HTTP `documentId`); with `trustedDocuments` it is replaced by `query` before `onParams`. */
	documentId?: string;
	operationName?: string;
	variables?: Record<string, unknown>;
	extensions?: Record<string, unknown>;
}

/** Fields every request-scoped payload carries. */
export interface BasePayload {
	request: Request;
	state: RequestState;
	/**
	 * Headers merged into the final response, whichever it is (the result, a
	 * 4xx, a short-circuit). `set-cookie` and `vary` are appended; any other
	 * header is set only when the response does not carry it.
	 */
	responseHeaders: Headers;
}

/** `onRequest`: `respond` ends the stage; later hooks are skipped. */
export interface OnRequestPayload extends BasePayload {
	respond(response: Response): void;
}
/** After-hook of `onRequest`. */
export interface OnRequestDone {
	response: Response | undefined;
}

/** `onParams`: replace the params or answer directly. */
export interface OnParamsPayload extends BasePayload {
	params: GraphQLParams;
	setParams(params: GraphQLParams): void;
	respond(response: Response): void;
}
/** After-hook of `onParams`. */
export interface OnParamsDone {
	params: GraphQLParams;
}

/** `onParse`: swap the parser or provide the document (skips parsing). */
export interface OnParsePayload extends BasePayload {
	params: GraphQLParams;
	setParseFn(fn: ParseFn): void;
	setDocument(document: DocumentNode): void;
}
/** After-hook of `onParse`. */
export interface OnParseDone {
	document: DocumentNode | undefined;
}

/** `onValidate`: swap the validator, add a rule, or provide the errors (skips validation). */
export interface OnValidatePayload extends BasePayload {
	schema: GraphQLSchema;
	document: DocumentNode;
	setValidationFn(fn: ValidationFn): void;
	addRule(rule: ValidationRule): void;
	setResult(errors: readonly GraphQLError[]): void;
}
/** After-hook of `onValidate`. */
export interface OnValidateDone {
	errors: readonly GraphQLError[] | undefined;
}

/** `onContext`: read the context built so far; return an object to merge into it. */
export interface OnContextPayload<Ctx = Empty> extends BasePayload {
	context: Ctx;
}

/** `onExecute` / `onSubscribe`: swap the function or provide the result (skips it). */
export interface OnExecutePayload<Ctx = Empty> extends BasePayload {
	args: ExecutionArgs & { contextValue: Ctx };
	setExecuteFn(fn: ExecuteFn): void;
	setResult(result: ExecutionOutput): void;
}
/** After-hook of `onExecute` / `onSubscribe`. */
export interface OnExecuteDone {
	result: ExecutionOutput | undefined;
	setResult(result: ExecutionOutput): void;
}
/** Payload of `onSubscribe`; same shape as `onExecute`. */
export type OnSubscribePayload<Ctx = Empty> = OnExecutePayload<Ctx>;

/** `onResultChunk`: one result chunk about to be sent; `setChunk` replaces it. */
export interface OnResultChunkPayload extends BasePayload {
	chunk: unknown;
	setChunk(chunk: unknown): void;
}

/** `onResponse`: the final response; `setResponse` replaces it. */
export interface OnResponsePayload extends BasePayload {
	response: Response;
	setResponse(response: Response): void;
}

/** Passed to `setup`. */
export interface SetupApi {
	/** Names of every plugin, in execution order. */
	plugins: readonly string[];
}

/**
 * A graxia plugin. `Ctx` is the context the plugin needs; `Added` is what its
 * `onContext` adds to it. Build one with `definePlugin`.
 */
export interface GraxiaPlugin<Ctx = Empty, Added = Empty> {
	name: string;
	enforce?: 'pre' | 'post' | undefined;
	/** Runs once at engine init, awaited. */
	setup?(api: SetupApi): MaybePromise<void>;
	onRequest?(payload: OnRequestPayload): HookReturn<OnRequestDone>;
	onParams?(payload: OnParamsPayload): HookReturn<OnParamsDone>;
	onParse?(payload: OnParsePayload): HookReturn<OnParseDone>;
	onValidate?(payload: OnValidatePayload): HookReturn<OnValidateDone>;
	/** The returned object is shallow-merged into the context. */
	onContext?(payload: OnContextPayload<Ctx>): MaybePromise<void | Added>;
	onExecute?(payload: OnExecutePayload<Ctx & Added>): HookReturn<OnExecuteDone>;
	onSubscribe?(
		payload: OnSubscribePayload<Ctx & Added>,
	): HookReturn<OnExecuteDone>;
	onResultChunk?(payload: OnResultChunkPayload): MaybePromise<void>;
	onResponse?(payload: OnResponsePayload): MaybePromise<void>;
	/**
	 * Runs once when `graxia.dispose()` finishes draining, in reverse plugin
	 * order: close the connections and timers the plugin opened in `setup`.
	 */
	onDispose?(): MaybePromise<void>;
	/** @internal phantom carriers for type inference. */
	readonly '~ctx'?: Ctx;
	readonly '~added'?: Added;
}
