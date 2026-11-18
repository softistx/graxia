import {
	type FieldNode,
	type GraphQLField,
	type GraphQLSchema,
	getArgumentValues,
	getDirectiveValues,
	getVariableValues,
	type OperationDefinitionNode,
	type VariableValues,
} from 'graphql';
import { listSizeDirective } from './directives';

/** The `@listSize` arguments of a field. */
export interface ListSize {
	assumedSize?: number | null;
	slicingArguments?: readonly string[] | null;
	sizedFields?: readonly string[] | null;
	requireOneSlicingArgument?: boolean | null;
}

/** The `@listSize` of a field, or an empty one. */
export function listSizeOf(def: GraphQLField<unknown, unknown>): ListSize {
	if (!def.astNode?.directives?.length) return {};
	return getDirectiveValues(listSizeDirective, def.astNode) ?? {};
}

/**
 * The coerced variable values of an operation (defaults included), or
 * `undefined` when the request's variables do not coerce: execution reports
 * that, so the cost is not checked.
 */
export function coerceVariables(
	schema: GraphQLSchema,
	operation: OperationDefinitionNode,
	given: Readonly<Record<string, unknown>> | undefined,
): VariableValues | undefined {
	const result = getVariableValues(
		schema,
		operation.variableDefinitions ?? [],
		given ?? {},
	);
	return 'errors' in result ? undefined : result.variableValues;
}

/** What the slicing arguments of one field gave. */
export type Slice = { size: number } | { size?: undefined; missing: boolean };

/**
 * The size the slicing arguments of `node` ask for: the largest of the ones
 * given (a name, or a dotted path into an input). `missing` when none has a
 * valid value (absent, null, negative or not an integer).
 */
export function slicedSize(
	def: GraphQLField<unknown, unknown>,
	node: FieldNode,
	config: ListSize,
	vars: VariableValues,
): Slice {
	const paths = config.slicingArguments ?? [];
	let args: Record<string, unknown> = {};
	try {
		args = getArgumentValues(def, node, vars);
	} catch {
		return { missing: paths.length > 0 };
	}
	let size: number | undefined;
	for (const path of paths) {
		const [head = '', ...rest] = path.split('.');
		let value: unknown = args[head];
		for (const key of rest)
			value = (value as Record<string, unknown> | null)?.[key];
		if (typeof value === 'number' && Number.isInteger(value) && value >= 0)
			size = Math.max(size ?? 0, Math.min(value, Number.MAX_SAFE_INTEGER));
	}
	return size === undefined ? { missing: paths.length > 0 } : { size };
}
