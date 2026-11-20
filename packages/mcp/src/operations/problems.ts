import { GraxiaConfigError } from '@graxia/core';

const EXCLUDE = 'or leave it out with operations.include';

/** The longest tool name MCP allows. */
export const MAX_TOOL_NAME = 128;

/** The boot problems of `operations`, each as what is wrong and what to write. */
export const problem = {
	manifest: () =>
		'operations.documents is not a manifest. Fix: pass a Map, an object of id to source (persisted-documents.json), or an Apollo persisted query manifest.',
	source: (id: string) =>
		`document "${id}" is not a GraphQL source string. Fix: map every id to the text of its document.`,
	parse: (id: string, message: string) =>
		`document "${id}" does not parse: ${message} Fix: regenerate the manifest; if it comes from another server's schema, do not pass it here.`,
	anonymous: (id: string) =>
		`document "${id}" holds an anonymous operation: a tool needs a name. Fix: name it (query BookById { ... }) and regenerate the manifest.`,
	invalid: (
		names: readonly string[],
		id: string,
		messages: readonly string[],
	) =>
		`${names.join(', ')} (document "${id}") is not valid against the schema: ${messages.join(' ')} Fix: regenerate the manifest from the current schema, ${EXCLUDE}.`,
	introspection: (names: readonly string[], id: string) =>
		`${names.join(', ')} (document "${id}") selects __schema or __type: introspection is not offered over MCP, an agent reads the schema with graphql_schema. Fix: leave the operation out with operations.include.`,
	incremental: (name: string, id: string, directive: string) =>
		`${name} (document "${id}") uses @${directive}, which is not available over MCP: a tool returns one complete result. Fix: remove @${directive}, ${EXCLUDE}.`,
	description: (name: string, id: string) =>
		`${name} (document "${id}") has no description: an agent picks a tool by its description. Fix: write one above the operation ("""Find a book by its id.""" query ${name} ...), or set operations.descriptions.${name}.`,
	reserved: (name: string, id: string, tool: string) =>
		`${name} (document "${id}") gives the tool name ${tool}, and graphql_* names are the generic tools'. Fix: rename the operation, ${EXCLUDE}.`,
	duplicate: (tool: string, a: Named, b: Named) =>
		`${a.name} (document "${a.id}") and ${b.name} (document "${b.id}") both give the tool name ${tool}. Fix: rename one of them, ${EXCLUDE}.`,
	tooLong: (name: string, id: string, tool: string) =>
		`${name} (document "${id}") gives a tool name of ${tool.length} characters, and MCP allows ${MAX_TOOL_NAME}. Fix: rename the operation, ${EXCLUDE}.`,
	unusedDescription: (key: string, close: string | undefined) =>
		`operations.descriptions.${key} matches no operation of operations.documents${close ? ` (there is ${close}: names are case-sensitive)` : ''}. Fix: ${close ? `rename the key to ${close}` : 'remove the key, or name it after an operation of the manifest'}.`,
	empty: () =>
		'genericTools is false and operations gives no tool: an agent would have nothing to call. Fix: check operations.documents and operations.include (mutations need mutations: true), or remove genericTools: false.',
};

interface Named {
	name: string;
	id: string;
}

/** One error for every problem found, so a manifest is fixed in one pass. */
export function operationsError(
	problems: readonly string[],
): GraxiaConfigError {
	return new GraxiaConfigError(
		`createMcp: operations has ${problems.length} problem${problems.length === 1 ? '' : 's'}:\n${problems.map((p) => `- ${p}`).join('\n')}`,
	);
}
