import {
	type DocumentNode,
	type FragmentDefinitionNode,
	Kind,
	type OperationDefinitionNode,
	type SelectionSetNode,
} from 'graphql';

/** What an operation's selections hold, fragments expanded. */
export interface SelectionStats {
	/** Levels of fields below (a leaf field is 1; `__typename` and introspection count nothing). */
	depth: number;
	/** Aliased fields. */
	aliases: number;
	/** Directive usages. */
	directives: number;
	/** Fields directly in the set, through fragments (not `__typename`). */
	fields: number;
}

/** The fragment definitions of `document`, by name. */
export function fragmentMap(
	document: DocumentNode,
): ReadonlyMap<string, FragmentDefinitionNode> {
	const fragments = new Map<string, FragmentDefinitionNode>();
	for (const definition of document.definitions)
		if (definition.kind === Kind.FRAGMENT_DEFINITION)
			fragments.set(definition.name.value, definition);
	return fragments;
}

const empty = (): SelectionStats => ({
	depth: 0,
	aliases: 0,
	directives: 0,
	fields: 0,
});

const introspection = new Set(['__schema', '__type']);

/** Walks operations of one document, memoising each fragment so the walk stays linear. */
export function createWalker(
	fragments: ReadonlyMap<string, FragmentDefinitionNode>,
) {
	const memo = new Map<string, SelectionStats>();
	const active = new Set<string>();

	function fragment(name: string): SelectionStats {
		const known = memo.get(name);
		if (known) return known;
		const definition = fragments.get(name);
		// A cycle (NoFragmentCycles reports it) or an unknown fragment adds nothing.
		if (!definition || active.has(name)) return empty();
		active.add(name);
		const stats = selection(definition.selectionSet);
		stats.directives += definition.directives?.length ?? 0;
		active.delete(name);
		memo.set(name, stats);
		return stats;
	}

	function selection(set: SelectionSetNode): SelectionStats {
		const total = empty();
		const merge = (child: SelectionStats, deeper: number) => {
			total.depth = Math.max(total.depth, child.depth + deeper);
			total.aliases += child.aliases;
			total.directives += child.directives;
		};
		for (const node of set.selections) {
			total.directives += node.directives?.length ?? 0;
			if (node.kind === Kind.FIELD) {
				const name = node.name.value;
				if (node.alias) total.aliases++;
				if (name === '__typename') continue;
				total.fields++;
				const child = node.selectionSet
					? selection(node.selectionSet)
					: empty();
				// An introspection root is a field, an alias and directives like any
				// other; only the depth of its subtree is exempt.
				if (introspection.has(name)) child.depth = 0;
				merge(child, 1);
			} else {
				const child =
					node.kind === Kind.FRAGMENT_SPREAD
						? fragment(node.name.value)
						: selection(node.selectionSet);
				merge(child, 0);
				total.fields += child.fields;
			}
		}
		return total;
	}

	return {
		/** The stats of one operation, its own directives included. */
		operation(node: OperationDefinitionNode): SelectionStats {
			const stats = selection(node.selectionSet);
			stats.directives += node.directives?.length ?? 0;
			return stats;
		},
	};
}
