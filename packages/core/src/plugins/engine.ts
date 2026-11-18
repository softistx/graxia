import type {
	DocumentNode,
	ExecutionArgs,
	GraphQLError,
	GraphQLSchema,
	ValidationRule,
} from 'graphql';
import { GraxiaConfigError } from '../errors/config-error';
import { GraxiaPluginError } from '../errors/plugin-error';
import { orderPlugins } from './order';
import { createStageRunner, type StageRunner } from './stage';
import type { RequestState } from './state';
import type {
	ExecuteFn,
	ExecutionOutput,
	GraphQLParams,
	GraxiaPlugin,
	HookStage,
	OnExecuteDone,
	OnParamsDone,
	OnParseDone,
	OnRequestDone,
	OnValidateDone,
	ParseFn,
	ValidationFn,
} from './types';

interface Base {
	request: Request;
	state: RequestState;
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
 */
export interface PluginRunners {
	onRequest: StageRunner<Base, RequestOut, OnRequestDone>;
	onParams: StageRunner<
		Base & { params: GraphQLParams },
		ParamsOut,
		OnParamsDone
	>;
	onParse: StageRunner<Base & { params: GraphQLParams }, ParseOut, OnParseDone>;
	onValidate: StageRunner<
		Base & { schema: GraphQLSchema; document: DocumentNode },
		ValidateOut,
		OnValidateDone
	>;
	onContext: StageRunner<
		Base & { context: Record<string, unknown> },
		ContextOut,
		void
	>;
	onExecute: StageRunner<
		Base & { args: ExecutionArgs },
		ExecuteOut,
		OnExecuteDone
	>;
	onSubscribe: StageRunner<
		Base & { args: ExecutionArgs },
		ExecuteOut,
		OnExecuteDone
	>;
	onResultChunk: StageRunner<Base & { chunk: unknown }, ChunkOut, void>;
	onResponse: StageRunner<Base & { response: Response }, ResponseOut, void>;
}

/** The plugin engine: ordered plugins, one runner per stage, one-time `init`. */
export interface PluginEngine {
	/** Plugin names in execution order. */
	readonly names: readonly string[];
	/** Whether any plugin defines the stage (lets a transport skip it entirely). */
	has(stage: HookStage): boolean;
	/** Runs every plugin's `setup` once, awaited; later calls return the same promise. */
	init(): Promise<void>;
	/** The stage runners. */
	readonly runners: PluginRunners;
}

/**
 * Creates the plugin engine over `plugins`: orders them (see `orderPlugins`),
 * and builds a runner per stage. A throwing hook rejects its stage with the
 * original error; only `setup` errors are wrapped (in `GraxiaPluginError`).
 */
export function createPluginEngine(
	plugins: readonly GraxiaPlugin<any, any>[],
): PluginEngine {
	const ordered = orderPlugins(plugins);
	const hooksOf = (stage: HookStage) =>
		ordered.flatMap((plugin) => {
			const fn = plugin[stage] as ((p: never) => never) | undefined;
			return fn ? [{ plugin: plugin.name, run: fn.bind(plugin) as never }] : [];
		});
	const executeSpec = {
		init: (): ExecuteOut => ({}),
		payload: (input: Base & { args: ExecutionArgs }, out: ExecuteOut) => ({
			...input,
			setExecuteFn: (fn: ExecuteFn) => {
				out.executeFn = fn;
			},
			setResult: (result: ExecutionOutput) => {
				out.result = result;
			},
		}),
	};
	const runners: PluginRunners = {
		onRequest: createStageRunner(hooksOf('onRequest'), {
			init: (): RequestOut => ({}),
			payload: (input: Base, out: RequestOut, stop) => ({
				...input,
				respond: (response: Response) => {
					out.response = response;
					stop();
				},
			}),
		}),
		onParams: createStageRunner<
			Base & { params: GraphQLParams },
			ParamsOut,
			OnParamsDone
		>(hooksOf('onParams'), {
			init: (input: Base & { params: GraphQLParams }): ParamsOut => ({
				params: input.params,
			}),
			payload: (input: Base, out: ParamsOut, stop) => ({
				...input,
				params: out.params,
				setParams: (params: GraphQLParams) => {
					out.params = params;
				},
				respond: (response: Response) => {
					out.response = response;
					stop();
				},
			}),
		}),
		onParse: createStageRunner(hooksOf('onParse'), {
			init: (): ParseOut => ({}),
			payload: (input: Base, out: ParseOut) => ({
				...input,
				setParseFn: (fn: ParseFn) => {
					out.parseFn = fn;
				},
				setDocument: (document: DocumentNode) => {
					out.document = document;
				},
			}),
		}),
		onValidate: createStageRunner(hooksOf('onValidate'), {
			init: (): ValidateOut => ({ rules: [] }),
			payload: (input: Base, out: ValidateOut) => ({
				...input,
				setValidationFn: (fn: ValidationFn) => {
					out.validationFn = fn;
				},
				addRule: (rule: ValidationRule) => {
					out.rules.push(rule);
				},
				setResult: (errors: readonly GraphQLError[]) => {
					out.errors = errors;
				},
			}),
		}),
		onContext: createStageRunner<
			Base & { context: Record<string, unknown> },
			ContextOut,
			void
		>(hooksOf('onContext'), {
			init: (input: { context: Record<string, unknown> }): ContextOut => ({
				context: { ...input.context },
			}),
			payload: (input: Base, out: ContextOut) => ({
				...input,
				context: out.context,
			}),
			collect: (out, returned, plugin) => {
				if (returned === undefined) return;
				if (
					typeof returned !== 'object' ||
					returned === null ||
					Array.isArray(returned)
				) {
					throw new GraxiaConfigError(
						`Plugin "${plugin}" onContext must return an object or nothing, got ${returned === null ? 'null' : Array.isArray(returned) ? 'array' : typeof returned}`,
					);
				}
				Object.assign(out.context, returned);
			},
		}),
		onExecute: createStageRunner(hooksOf('onExecute'), executeSpec),
		onSubscribe: createStageRunner(hooksOf('onSubscribe'), executeSpec),
		onResultChunk: createStageRunner<Base & { chunk: unknown }, ChunkOut, void>(
			hooksOf('onResultChunk'),
			{
				init: (input: Base & { chunk: unknown }): ChunkOut => ({
					chunk: input.chunk,
				}),
				payload: (input: Base, out: ChunkOut) => ({
					...input,
					chunk: out.chunk,
					setChunk: (chunk: unknown) => {
						out.chunk = chunk;
					},
				}),
			},
		),
		onResponse: createStageRunner<
			Base & { response: Response },
			ResponseOut,
			void
		>(hooksOf('onResponse'), {
			init: (input: Base & { response: Response }): ResponseOut => ({
				response: input.response,
			}),
			payload: (input: Base, out: ResponseOut) => ({
				...input,
				response: out.response,
				setResponse: (response: Response) => {
					out.response = response;
				},
			}),
		}),
	};
	const names = ordered.map((p) => p.name);
	let initialised: Promise<void> | undefined;
	return {
		names,
		runners,
		has: (stage) => ordered.some((p) => typeof p[stage] === 'function'),
		init() {
			initialised ??= (async () => {
				for (const plugin of ordered) {
					try {
						await plugin.setup?.({ plugins: names });
					} catch (error) {
						throw new GraxiaPluginError(plugin.name, error);
					}
				}
			})();
			return initialised;
		},
	};
}
