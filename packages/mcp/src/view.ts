import { type Can, printSchemaFor } from '@graxia/core/agent';
import {
	buildSchema,
	type DefinitionNode,
	type GraphQLSchema,
	Kind,
	parse,
} from 'graphql';

/** The schema as one caller may see it, with the SDL of each type ready to hand out. */
export interface View {
	/** The visible schema: validate operations against it. */
	schema: GraphQLSchema;
	/** SDL of each visible type, by name, in schema order (descriptions and applied agent directives kept). */
	types: ReadonlyMap<string, string>;
	/** SDL of each directive definition the visible SDL declares, by name. */
	directives: ReadonlyMap<string, string>;
}

const nameOf = (definition: DefinitionNode): string | undefined =>
	'name' in definition ? definition.name?.value : undefined;

/** Builds the view of a caller (`can` absent: everything). Walks the whole schema, so cache it per kind of caller. */
export function buildView(schema: GraphQLSchema, can?: Can): View {
	const sdl = printSchemaFor(schema, can ? { can } : {});
	const types = new Map<string, string>();
	const directives = new Map<string, string>();
	for (const definition of parse(sdl, { noLocation: false }).definitions) {
		const name = nameOf(definition);
		const loc = definition.loc;
		if (name === undefined || !loc) continue;
		const text = sdl.slice(loc.start, loc.end);
		if (definition.kind === Kind.DIRECTIVE_DEFINITION)
			directives.set(name, text);
		else if (definition.kind !== Kind.SCHEMA_DEFINITION) types.set(name, text);
	}
	return { schema: buildSchema(sdl), types, directives };
}

/** The directive definitions that the SDL `texts` use, so the output is self-contained. */
export function directivesUsedBy(
	view: View,
	texts: readonly string[],
): string[] {
	const joined = texts.join('\n');
	return [...view.directives]
		.filter(([name]) => new RegExp(`@${name}\\b`).test(joined))
		.map(([, text]) => text);
}
