import type { GraphQLSchema } from 'graphql';
import {
	createDocumentPipeline,
	type DocumentPipeline,
} from '../document/pipeline';
import { operationLimitRules } from '../limits/rules';
import type { PluginEngine } from '../plugins/engine';
import { noIntrospectionRule } from '../security/introspection';
import type { Telemetry } from '../telemetry';
import type { ResolvedTrusted } from '../trusted/options';
import {
	createTrustedDocuments,
	type TrustedDocuments,
} from '../trusted/resolve';
import type { Lifecycle } from './lifecycle';
import { createResultMasker, type ResultMasker } from './masking';
import type { GraxiaOptions, ResolvedOptions } from './options';
import type { UnexpectedHandler } from './unexpected';

/** @internal Everything a request needs, built once by `createGraxia`. */
export interface Runtime {
	schema: GraphQLSchema;
	engine: PluginEngine;
	pipeline: DocumentPipeline;
	options: ResolvedOptions;
	/** Trusted documents and persisted queries, or `undefined` when `trustedDocuments` is absent. */
	trusted: TrustedDocuments | undefined;
	context: GraxiaOptions<any>['context'];
	unexpected: UnexpectedHandler;
	/** Masks the unexpected errors of a result before it is encoded. */
	maskResult: ResultMasker;
	lifecycle: Lifecycle;
	/** The tracing hooks; the off implementation when tracing is off. */
	telemetry: Telemetry;
	/** Resolves once every plugin's `setup` ran. */
	ready: Promise<void>;
}

/** @internal The parts `createGraxia` builds before the runtime. */
export interface RuntimeParts {
	resolved: ResolvedOptions;
	trusted: ResolvedTrusted | undefined;
	telemetry: Telemetry;
	engine: PluginEngine;
	unexpected: UnexpectedHandler;
	lifecycle: Lifecycle;
	ready: Promise<void>;
}

/** @internal Assembles the {@link Runtime}: pipeline with its rules, trusted documents, masking. */
export function buildRuntime(
	options: GraxiaOptions<any>,
	parts: RuntimeParts,
): Runtime {
	const { resolved, trusted, unexpected } = parts;
	return {
		schema: options.schema,
		engine: parts.engine,
		pipeline: createDocumentPipeline({
			schema: options.schema,
			engine: parts.engine,
			...(options.limits ? { limits: options.limits } : {}),
			rules: [
				...operationLimitRules(resolved.operationLimits),
				...(resolved.introspection ? [] : [noIntrospectionRule]),
			],
			hideSuggestions: !resolved.suggestions,
			...(options.caches !== undefined ? { caches: options.caches } : {}),
		}),
		options: resolved,
		unexpected,
		maskResult: createResultMasker(
			options.maskError,
			options.maskErrors ?? true,
			options.schema,
			unexpected,
		),
		trusted:
			trusted &&
			createTrustedDocuments(trusted, (error, state) =>
				unexpected.report(error, state),
			),
		context: options.context,
		lifecycle: parts.lifecycle,
		telemetry: parts.telemetry,
		ready: parts.ready,
	};
}
