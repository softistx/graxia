import {
	type DocumentNode,
	type FieldNode,
	type FragmentDefinitionNode,
	type GraphQLNamedType,
	type GraphQLOutputType,
	type GraphQLSchema,
	getDirectiveValues,
	getNamedType,
	getNullableType,
	isCompositeType,
	isInterfaceType,
	isListType,
	isObjectType,
	Kind,
	type OperationDefinitionNode,
	type SelectionSetNode,
	type VariableValues,
} from 'graphql';
import { costDirective } from './directives';
import type { ResolvedCost } from './options';
import { listSizeOf, slicedSize } from './slicing';
import { fragmentMap } from './walk';

type Sizes = ReadonlyMap<string, number>;
const noSizes: Sizes = new Map();
const introspection = new Set(['__schema', '__type']);

/** What a cost computation reads and records; data only. */
interface CostContext {
	schema: GraphQLSchema;
	fragments: ReadonlyMap<string, FragmentDefinitionNode>;
	vars: VariableValues;
	options: ResolvedCost;
	/** Whether `requireOneSlicingArgument` is enforced (the server) or ignored (the pure helper). */
	strict: boolean;
	memo: Map<string, number>;
	active: Set<string>;
	/** Messages of the fields whose required slicing argument has no valid value. */
	missing: string[];
}

const weightOf = (
	node:
		| { readonly directives?: readonly unknown[] | undefined }
		| undefined
		| null,
) => {
	if (!node?.directives?.length) return undefined;
	const values = getDirectiveValues(costDirective, node as never);
	return typeof values?.['weight'] === 'number' ? values['weight'] : undefined;
};

function listLevels(type: GraphQLOutputType): number {
	let levels = 0;
	let current = getNullableType(type);
	while (isListType(current)) {
		levels++;
		current = getNullableType(current.ofType);
	}
	return levels;
}

const signature = (sizes: Sizes): string =>
	[...sizes]
		.sort()
		.map(([name, size]) => `${name}=${size}`)
		.join(',');

function fragmentCost(
	ctx: CostContext,
	definition: FragmentDefinitionNode,
	sizes: Sizes,
	parent: GraphQLNamedType | undefined,
): number {
	const key = `${definition.name.value}|${signature(sizes)}`;
	const cached = ctx.memo.get(key);
	if (cached !== undefined) return cached;
	if (ctx.active.has(key)) return 0;
	ctx.active.add(key);
	const type =
		ctx.schema.getType(definition.typeCondition.name.value) ?? parent;
	const cost = selectionCost(ctx, type, definition.selectionSet, sizes);
	ctx.active.delete(key);
	ctx.memo.set(key, cost);
	return cost;
}

function selectionCost(
	ctx: CostContext,
	parent: GraphQLNamedType | undefined,
	set: SelectionSetNode,
	sizes: Sizes,
): number {
	let total = 0;
	for (const node of set.selections) {
		if (node.kind === Kind.FIELD) total += fieldCost(ctx, parent, node, sizes);
		else if (node.kind === Kind.INLINE_FRAGMENT) {
			const type = node.typeCondition
				? (ctx.schema.getType(node.typeCondition.name.value) ?? parent)
				: parent;
			total += selectionCost(ctx, type, node.selectionSet, sizes);
		} else {
			const definition = ctx.fragments.get(node.name.value);
			if (definition) total += fragmentCost(ctx, definition, sizes, parent);
		}
	}
	return total;
}

function fieldCost(
	ctx: CostContext,
	parent: GraphQLNamedType | undefined,
	node: FieldNode,
	sizes: Sizes,
): number {
	const name = node.name.value;
	if (name === '__typename') return 0;
	// An introspection root costs like an object; its subtree is not walked.
	if (introspection.has(name)) return ctx.options.objectCost;
	if (!isObjectType(parent) && !isInterfaceType(parent)) return 0;
	const def = parent.getFields()[name];
	if (!def) return 0;
	const named = getNamedType(def.type);
	const own = weightOf(def.astNode);
	const perObject =
		own === undefined
			? (weightOf(named.astNode) ??
				(isCompositeType(named)
					? ctx.options.objectCost
					: ctx.options.scalarCost))
			: 0;
	const config = listSizeOf(def);
	const slice = slicedSize(def, node, config, ctx.vars);
	const paths = config.slicingArguments ?? [];
	if (
		ctx.strict &&
		slice.size === undefined &&
		slice.missing &&
		config.requireOneSlicingArgument !== false
	)
		ctx.missing.push(
			`Field ${parent.name}.${name} requires one of its slicing arguments (${paths.join(', ')}).`,
		);
	const computed =
		slice.size ?? config.assumedSize ?? ctx.options.defaultListSize;
	const childSizes: Sizes = config.sizedFields?.length
		? new Map(config.sizedFields.map((child) => [child, computed]))
		: noSizes;
	const children = node.selectionSet
		? selectionCost(ctx, named, node.selectionSet, childSizes)
		: 0;
	const levels = listLevels(def.type);
	const inner = config.assumedSize ?? ctx.options.defaultListSize;
	const multiplier =
		levels === 0
			? (sizes.get(name) ?? 1)
			: (sizes.get(name) ?? computed) * inner ** (levels - 1);
	return (own ?? 0) + multiplier * (perObject + children);
}

export function computeCost(
	schema: GraphQLSchema,
	document: DocumentNode,
	operation: OperationDefinitionNode,
	vars: VariableValues,
	options: ResolvedCost,
	strict: boolean,
): { cost: number; missing: string[] } {
	const ctx: CostContext = {
		schema,
		fragments: fragmentMap(document),
		vars,
		options,
		strict,
		memo: new Map(),
		active: new Set(),
		missing: [],
	};
	const root = schema.getRootType(operation.operation);
	const cost = root
		? selectionCost(ctx, root, operation.selectionSet, noSizes)
		: 0;
	return { cost, missing: ctx.missing };
}
