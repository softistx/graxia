import {
	type DocumentNode,
	type FieldNode,
	type FragmentDefinitionNode,
	Kind,
	type OperationDefinitionNode,
	print,
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
	/** Selections of the tracked field names, in the order first selected; empty unless `createWalker` got names to track. */
	tracked: Map<string, Tracked>;
}

/** How a tracked field is selected in a document. */
export interface Tracked {
	/** Selections as written, fragments expanded (a fragment spread twice counts twice). */
	count: number;
	/** The distinct paths it is selected at (parents' response keys and arguments included), at most 2: only "one or more" matters. */
	paths: string[];
}

const noTracked = new Map<string, Tracked>();

/** Adds `child`'s tracked selections to `into`, their paths under `prefix`. */
function mergeTracked(
	into: Map<string, Tracked>,
	child: Map<string, Tracked>,
	prefix: string,
): void {
	for (const [name, from] of child) {
		const to = into.get(name) ?? { count: 0, paths: [] };
		into.set(name, to);
		to.count += from.count;
		for (const path of from.paths) {
			const full = prefix + path;
			if (to.paths.length < 2 && !to.paths.includes(full)) to.paths.push(full);
		}
	}
}

/** `alias: name(args)` as one path segment. */
function segment(node: FieldNode): string {
	const args = node.arguments?.map((a) => print(a)).join(',') ?? '';
	return `${node.alias?.value ?? node.name.value}(${args})/`;
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

const introspection = new Set(['__schema', '__type']);

/**
 * Walks operations of one document, memoising each fragment so the walk stays linear.
 * `track` names fields whose selections are collected in `SelectionStats.tracked`.
 */
export function createWalker(
	fragments: ReadonlyMap<string, FragmentDefinitionNode>,
	track?: ReadonlySet<string>,
) {
	const empty = (): SelectionStats => ({
		depth: 0,
		aliases: 0,
		directives: 0,
		fields: 0,
		tracked: track ? new Map() : noTracked,
	});
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

	/** One selection of tracked field `name` at `path`. */
	const own = (name: string, path: string) =>
		new Map<string, Tracked>([[name, { count: 1, paths: [path] }]]);

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
				if (track && !introspection.has(name)) {
					const here = segment(node);
					if (track.has(name)) mergeTracked(total.tracked, own(name, here), '');
					mergeTracked(total.tracked, child.tracked, here);
				}
			} else {
				const child =
					node.kind === Kind.FRAGMENT_SPREAD
						? fragment(node.name.value)
						: selection(node.selectionSet);
				merge(child, 0);
				total.fields += child.fields;
				if (track) mergeTracked(total.tracked, child.tracked, '');
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
