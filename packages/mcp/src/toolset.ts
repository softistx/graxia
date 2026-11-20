import { GraxiaConfigError } from '@graxia/core';
import { buildOperationTools } from './operations/build';
import { operationsError, problem } from './operations/problems';
import type { OperationTool } from './operations/types';
import { createVisibleTools } from './operations/visible';
import type { McpHost, McpOptions } from './options';
import type { View } from './view';

/**
 * How `graphql_query` and `graphql_mutate` stand: `on`, `off`
 * (`genericTools: false`), or `refused` when graxia runs trusted documents
 * in strict mode, where a document an agent writes must not run.
 */
export type GenericTools = 'on' | 'off' | 'refused';

/** The tools of one `createMcp`, decided once at boot. */
export interface Toolset {
	/** The typed tools of `operations`; empty without it. */
	typed: readonly OperationTool[];
	generic: GenericTools;
	/** The typed tools a view allows. */
	visible(view: View): readonly OperationTool[];
	/**
	 * Whether `name` is a tool that writes and that this caller would be
	 * offered with the write scope: `graphql_mutate`, or the typed tool of a
	 * mutation the caller's view allows. A view that fails to build offers none.
	 */
	writes(name: string, view: () => Promise<View>): Promise<boolean>;
}

/** The typed tools of `operations`, built once; `genericTools: false` needs at least one. */
function typedTools(
	graxia: McpHost<any>,
	options: McpOptions<any>,
	mutations: boolean,
): OperationTool[] {
	const generic = options.genericTools ?? true;
	if (!options.operations) {
		if (!generic)
			throw new GraxiaConfigError(
				'createMcp: genericTools is false and there is no operations: an agent would have nothing to call. Fix: pass operations: { documents: manifest }, or remove genericTools: false.',
			);
		return [];
	}
	const typed = buildOperationTools(
		graxia.schema,
		options.operations,
		mutations,
	);
	if (!generic && typed.length === 0) throw operationsError([problem.empty()]);
	return typed;
}

/**
 * Builds the tools of a server: the typed tools of `operations`, and how the
 * generic ones stand.
 * @throws {GraxiaConfigError} for a problem in `operations`, or `genericTools: false` with no typed tool.
 */
export function createToolset(
	graxia: McpHost<any>,
	options: McpOptions<any>,
	mutations: boolean,
): Toolset {
	const typed = typedTools(graxia, options, mutations);
	const generic: GenericTools =
		options.genericTools === false
			? 'off'
			: graxia.trustedDocuments?.mode === 'strict'
				? 'refused'
				: 'on';
	const visible = createVisibleTools(typed);
	const writing = new Map(
		typed.filter((tool) => tool.kind === 'mutation').map((t) => [t.name, t]),
	);
	return {
		typed,
		generic,
		visible,
		async writes(name, view) {
			if (name === 'graphql_mutate') return generic === 'on';
			const tool = writing.get(name);
			if (!tool) return false;
			try {
				return visible(await view()).includes(tool);
			} catch {
				// The factory reports the failure; an unknown view opens nothing.
				return false;
			}
		},
	};
}
