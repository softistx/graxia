import {
	type DocumentNode,
	execute,
	type GraphQLError,
	type ValidationRule,
} from 'graphql';
import { GraxiaConfigError } from '../../errors/config-error';
import { stampRaisedByGraphql } from '../../errors/fixes';
import { createStageRunner, type StageSpec } from '../stage';
import type {
	ExecuteFn,
	ExecutionOutput,
	GraphQLParams,
	OnParamsInput,
	ParseFn,
	ValidationFn,
} from '../types';
import type {
	Base,
	ChunkOut,
	ContextOut,
	ExecuteOut,
	Host,
	ParamsOut,
	ParseOut,
	PluginRunners,
	RequestOut,
	ResponseOut,
	ValidateOut,
} from './outputs';

/** A hook of one plugin, bound to it. `any`: see {@link buildRunners}. */
type Hooks = { plugin: string; run: (payload: never) => never }[];

// Each spec says how a stage builds its payload (with its setters) and what
// it collects. Setters write into `out`; only `respond` calls `stop`.

const requestSpec: StageSpec<Base & Host, RequestOut> = {
	init: () => ({}),
	payload: (input, out, stop) => ({
		...input,
		responseHeaders: input.state.responseHeaders,
		respond: (response: Response) => {
			out.response = response;
			stop();
		},
	}),
};

const paramsSpec: StageSpec<Base & OnParamsInput, ParamsOut> = {
	init: (input) => ({ params: input.params }),
	payload: (input, out, stop) => ({
		...input,
		responseHeaders: input.state.responseHeaders,
		params: out.params,
		setParams: (params: GraphQLParams) => {
			out.params = params;
		},
		respond: (response: Response) => {
			out.response = response;
			stop();
		},
	}),
};

const parseSpec: StageSpec<Base & Host, ParseOut> = {
	init: () => ({}),
	payload: (input, out) => ({
		...input,
		responseHeaders: input.state.responseHeaders,
		setParseFn: (fn: ParseFn) => {
			out.parseFn = fn;
		},
		setDocument: (document: DocumentNode) => {
			out.document = document;
		},
	}),
};

const validateSpec: StageSpec<Base & Host, ValidateOut> = {
	init: () => ({ rules: [] }),
	payload: (input, out) => ({
		...input,
		responseHeaders: input.state.responseHeaders,
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
};

const contextSpec: StageSpec<
	Base & { context: Record<string, unknown> },
	ContextOut
> = {
	afterHooks: false,
	init: (input) => ({ context: { ...input.context } }),
	payload: (input, out) => ({
		...input,
		responseHeaders: input.state.responseHeaders,
		context: out.context,
	}),
	collect: (out, returned, plugin) => {
		if (returned === undefined) return;
		if (
			typeof returned !== 'object' ||
			returned === null ||
			Array.isArray(returned)
		) {
			const got =
				returned === null
					? 'null'
					: Array.isArray(returned)
						? 'array'
						: typeof returned;
			throw new GraxiaConfigError(
				`Plugin "${plugin}" onContext must return an object or nothing, got ${got}`,
			);
		}
		Object.assign(out.context, returned);
	},
};

const executeSpec: StageSpec<
	Base & { fallback?: ExecuteFn | undefined },
	ExecuteOut
> = {
	init: () => ({}),
	payload: (input, out) => ({
		request: input.request,
		state: input.state,
		args: (input as { args?: unknown }).args,
		responseHeaders: input.state.responseHeaders,
		get executeFn(): ExecuteFn {
			return out.executeFn ?? input.fallback ?? stampedExecute;
		},
		setExecuteFn: (fn: ExecuteFn) => {
			out.executeFn = fn;
		},
		setResult: (result: ExecutionOutput) => {
			out.result = result;
		},
	}),
};

/** Core's `execute`, for a stage run without a fallback (engine specs). */
const stampedExecute: ExecuteFn = async (args) =>
	stampRaisedByGraphql(await execute(args));

const chunkSpec: StageSpec<Base & { chunk: unknown }, ChunkOut> = {
	afterHooks: false,
	init: (input) => ({ chunk: input.chunk }),
	payload: (input, out) => ({
		...input,
		responseHeaders: input.state.responseHeaders,
		chunk: out.chunk,
		setChunk: (chunk: unknown) => {
			out.chunk = chunk;
		},
	}),
};

const responseSpec: StageSpec<Base & { response: Response }, ResponseOut> = {
	afterHooks: false,
	init: (input) => ({ response: input.response }),
	payload: (input, out) => ({
		...input,
		responseHeaders: input.state.responseHeaders,
		response: out.response,
		setResponse: (response: Response) => {
			out.response = response;
		},
	}),
};

/**
 * Builds one runner per stage from the ordered plugins' hooks.
 *
 * Typing note: a plugin's typed context (`GraxiaPlugin<Ctx, Added>`) only
 * exists at the definition site (`definePlugin`). The engine holds plugins of
 * every context shape in one list, so its boundary erases that typing
 * (`GraxiaPlugin<any, any>`, hooks cast `as never`); the specs above build
 * the payloads, and the public runner types in `outputs.ts` restore the shape.
 */
export function buildRunners(
	hooksOf: (stage: keyof PluginRunners) => Hooks,
): PluginRunners {
	return {
		onRequest: createStageRunner(hooksOf('onRequest'), requestSpec),
		onParams: createStageRunner(hooksOf('onParams'), paramsSpec),
		onParse: createStageRunner(hooksOf('onParse'), parseSpec),
		onValidate: createStageRunner(hooksOf('onValidate'), validateSpec),
		onContext: createStageRunner(hooksOf('onContext'), contextSpec),
		onExecute: createStageRunner(hooksOf('onExecute'), executeSpec),
		onSubscribe: createStageRunner(hooksOf('onSubscribe'), executeSpec),
		onResultChunk: createStageRunner(hooksOf('onResultChunk'), chunkSpec),
		onResponse: createStageRunner(hooksOf('onResponse'), responseSpec),
	};
}
