import type { GraphQLSchema } from 'graphql';
import type { DocumentPipeline } from '../document/pipeline';
import type { PluginEngine } from '../plugins/engine';
import type { Lifecycle } from './lifecycle';
import type { GraxiaOptions, ResolvedOptions } from './options';
import type { UnexpectedHandler } from './unexpected';

/** @internal Everything a request needs, built once by `createGraxia`. */
export interface Runtime {
	schema: GraphQLSchema;
	engine: PluginEngine;
	pipeline: DocumentPipeline;
	options: ResolvedOptions;
	context: GraxiaOptions<any>['context'];
	unexpected: UnexpectedHandler;
	lifecycle: Lifecycle;
	/** Resolves once every plugin's `setup` ran. */
	ready: Promise<void>;
}
