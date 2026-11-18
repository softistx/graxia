import {
	type DocumentNode,
	type FieldNode,
	type FragmentDefinitionNode,
	type GraphQLError,
	type GraphQLField,
	type GraphQLNamedType,
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
	valueFromAST,
} from 'graphql';
import { costDirective, listSizeDirective } from './directives';
import { limitError } from './error';
import {
	type CostOptions,
	type ResolvedCost,
	resolveCostOptions,
} from './options';
import { fragmentMap } from './walk';

type Sizes = ReadonlyMap<string, number>;
const noSizes: Sizes = new Map();
const skipped = new Set(['__schema', '__type', '__typename']);

interface ListSize {
	assumedSize?: number | null;
	slicingArguments?: readonly string[] | null;
	sizedFields?: readonly string[] | null;
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

/** The variable values an operation sees: the request's, then the declared defaults. */
function variableValues(
	schema: GraphQLSchema,
	operation: OperationDefinitionNode,
	given: Readonly<Record<string, unknown>> | undefined,
): Record<string, unknown> {
	const values: Record<string, unknown> = { ...given };
	for (const definition of operation.variableDefinitions ?? []) {
		const name = definition.variable.name.value;
		if (values[name] !== undefined || !definition.defaultValue) continue;
		const type = schema.getType(unwrap(definition.type).name.value);
		if (type) {
			const fallback = valueFromAST(definition.defaultValue, type as never);
			if (fallback !== undefined) values[name] = fallback;
		}
	}
	return values;
}

function unwrap(type: any): { name: { value: string } } {
	return type.kind === Kind.NAMED_TYPE ? type : unwrap(type.type);
}

/** The cost of `operation` over `schema`; see {@link computeOperationCost}. */
export function operationCost(
	schema: GraphQLSchema,
	document: DocumentNode,
	operation: OperationDefinitionNode,
	variables: Readonly<Record<string, unknown>> | undefined,
	options: ResolvedCost,
): number {
	const fragments = fragmentMap(document);
	const vars = variableValues(schema, operation, variables);
	const memo = new Map<string, number>();
	const active = new Set<string>();

	function fragment(
		definition: FragmentDefinitionNode,
		sizes: Sizes,
		parent: GraphQLNamedType | undefined,
	): number {
		const name = definition.name.value;
		const cached = sizes.size === 0 ? memo.get(name) : undefined;
		if (cached !== undefined) return cached;
		if (active.has(name)) return 0;
		active.add(name);
		const type = schema.getType(definition.typeCondition.name.value) ?? parent;
		const cost = selection(type, definition.selectionSet, sizes);
		active.delete(name);
		if (sizes.size === 0) memo.set(name, cost);
		return cost;
	}

	function selection(
		parent: GraphQLNamedType | undefined,
		set: SelectionSetNode,
		sizes: Sizes,
	): number {
		let total = 0;
		for (const node of set.selections) {
			if (node.kind === Kind.FIELD) total += field(parent, node, sizes);
			else if (node.kind === Kind.INLINE_FRAGMENT) {
				const type = node.typeCondition
					? (schema.getType(node.typeCondition.name.value) ?? parent)
					: parent;
				total += selection(type, node.selectionSet, sizes);
			} else {
				const definition = fragments.get(node.name.value);
				if (definition) total += fragment(definition, sizes, parent);
			}
		}
		return total;
	}

	function slicedSize(
		def: GraphQLField<unknown, unknown>,
		node: FieldNode,
		config: ListSize,
	): number | undefined {
		let size: number | undefined;
		for (const path of config.slicingArguments ?? []) {
			const [head = '', ...rest] = path.split('.');
			const arg = def.args.find((candidate) => candidate.name === head);
			const given = node.arguments?.find((a) => a.name.value === head);
			if (!arg || !given) continue;
			let value: unknown = valueFromAST(given.value, arg.type, vars);
			for (const key of rest)
				value = (value as Record<string, unknown> | null)?.[key];
			if (typeof value === 'number' && Number.isFinite(value))
				size = Math.max(size ?? 0, Math.max(0, Math.floor(value)));
		}
		return size;
	}

	function field(
		parent: GraphQLNamedType | undefined,
		node: FieldNode,
		sizes: Sizes,
	): number {
		const name = node.name.value;
		if (skipped.has(name)) return 0;
		if (!isObjectType(parent) && !isInterfaceType(parent)) return 0;
		const def = parent.getFields()[name];
		if (!def) return 0;
		const named = getNamedType(def.type);
		const own = weightOf(def.astNode);
		const perObject =
			own === undefined
				? (weightOf(named.astNode) ??
					(isCompositeType(named) ? options.objectCost : options.scalarCost))
				: 0;
		const config: ListSize =
			(def.astNode?.directives?.length
				? getDirectiveValues(listSizeDirective, def.astNode)
				: undefined) ?? {};
		const computed =
			slicedSize(def, node, config) ??
			config.assumedSize ??
			options.defaultListSize;
		const childSizes: Sizes = config.sizedFields?.length
			? new Map(config.sizedFields.map((child) => [child, computed]))
			: noSizes;
		const children = node.selectionSet
			? selection(named, node.selectionSet, childSizes)
			: 0;
		const size = isListType(getNullableType(def.type))
			? (sizes.get(name) ?? computed)
			: (sizes.get(name) ?? 1);
		return (own ?? 0) + size * (perObject + children);
	}

	const root = schema.getRootType(operation.operation);
	return root ? selection(root, operation.selectionSet, noSizes) : 0;
}

/** Arguments of {@link computeOperationCost}. */
export interface ComputeCostArgs {
	schema: GraphQLSchema;
	document: DocumentNode;
	/** Which operation to cost when the document has several. */
	operationName?: string;
	/** The request's variables (a slicing argument such as `first: $n` reads them). */
	variables?: Readonly<Record<string, unknown>>;
	/** Cost settings; `max` is not used. */
	options?: CostOptions;
}

/**
 * The cost of an operation as `limits.cost` counts it: `@cost` weights (else
 * `objectCost` / `scalarCost`), list fields multiplied by their `@listSize`
 * (slicing argument, `assumedSize`, else `defaultListSize`), introspection
 * ignored. Returns 0 when no operation matches.
 */
export function computeOperationCost(args: ComputeCostArgs): number {
	const operations = args.document.definitions.filter(
		(d): d is OperationDefinitionNode => d.kind === Kind.OPERATION_DEFINITION,
	);
	const operation =
		args.operationName === undefined
			? operations[0]
			: operations.find((o) => o.name?.value === args.operationName);
	if (!operation) return 0;
	return operationCost(
		args.schema,
		args.document,
		operation,
		args.variables,
		resolveCostOptions(args.options),
	);
}

/** The error to refuse `operation` with when its cost is over `options.max`, else nothing. */
export function costRefusal(
	schema: GraphQLSchema,
	document: DocumentNode,
	operation: OperationDefinitionNode,
	variables: Readonly<Record<string, unknown>> | undefined,
	options: ResolvedCost,
): readonly GraphQLError[] | undefined {
	const actual = operationCost(schema, document, operation, variables, options);
	if (actual <= options.max) return undefined;
	return [
		limitError(
			`Operation cost ${actual} exceeds the limit of ${options.max}.`,
			{ name: 'cost', max: options.max, actual },
			'Request fewer items (use the slicing arguments, such as first) or raise limits.cost.max.',
			operation,
		),
	];
}
