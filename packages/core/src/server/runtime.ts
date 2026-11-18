import type { GraphQLSchema } from 'graphql';
import type { DocumentPipeline } from '../document/pipeline';
import type { PluginEngine } from '../plugins/engine';
import type { Telemetry } from '../telemetry';
import type { TrustedDocuments } from '../trusted/resolve';
import type { Lifecycle } from './lifecycle';
import type { ResultMasker } from './masking';
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
	/** The OpenTelemetry hooks; the off implementation when tracing is off. */
	telemetry: Telemetry;
	/** Resolves once every plugin's `setup` ran. */
	ready: Promise<void>;
}
