import {
	GraphQLDeferDirective,
	GraphQLSchema,
	GraphQLStreamDirective,
} from 'graphql';

/**
 * Adds `@defer` and `@stream` to a schema built from SDL, unless the SDL
 * declares them itself (graphql's SDL builder only adds the directives
 * defined by the specification).
 */
export function withIncrementalDirectives(
	schema: GraphQLSchema,
): GraphQLSchema {
	const missing = [GraphQLDeferDirective, GraphQLStreamDirective].filter(
		(directive) => schema.getDirective(directive.name) === undefined,
	);
	if (missing.length === 0) return schema;
	const config = schema.toConfig();
	return new GraphQLSchema({
		...config,
		directives: [...config.directives, ...missing],
	});
}
