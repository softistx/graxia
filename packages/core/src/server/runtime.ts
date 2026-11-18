import type { GraphQLSchema } from 'graphql';
import type { DocumentPipeline } from '../document/pipeline';
import type { PluginEngine } from '../plugins/engine';
import type { GraxiaOptions, ResolvedOptions } from './options';

/** @internal Everything a request needs, built once by `createGraxia`. */
export interface Runtime {
	schema: GraphQLSchema;
	engine: PluginEngine;
	pipeline: DocumentPipeline;
	options: ResolvedOptions;
	context: GraxiaOptions<any>['context'];
	/** Resolves once every plugin's `setup` ran. */
	ready: Promise<void>;
}
