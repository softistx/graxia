import type {
	DocumentNode,
	GraphQLError,
	GraphQLSchema,
	OperationDefinitionNode,
} from 'graphql';
import { Kind } from 'graphql';
import { computeCost } from './cost';
import { limitError } from './error';
import {
	type CostOptions,
	type ResolvedCost,
	resolveCostOptions,
} from './options';
import { coerceVariables } from './slicing';

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
 * roots as objects. Returns 0 when no operation matches. A missing slicing
 * argument falls back to the default size here; `limits.cost` refuses it.
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
	const vars = coerceVariables(args.schema, operation, args.variables) ?? {
		sources: {},
		coerced: {},
	};
	return computeCost(
		args.schema,
		args.document,
		operation,
		vars,
		resolveCostOptions(args.options),
		false,
	).cost;
}

/**
 * The errors that refuse `operation` (a required slicing argument without a
 * value, or a cost over `options.max`), else nothing. Variables that do not
 * coerce are left to execution, which reports them.
 */
export function costRefusal(
	schema: GraphQLSchema,
	document: DocumentNode,
	operation: OperationDefinitionNode,
	variables: Readonly<Record<string, unknown>> | undefined,
	options: ResolvedCost,
): readonly GraphQLError[] | undefined {
	const vars = coerceVariables(schema, operation, variables);
	if (!vars) return undefined;
	const { cost, missing } = computeCost(
		schema,
		document,
		operation,
		vars,
		options,
		true,
	);
	const limit = { name: 'cost', max: options.max, actual: cost };
	if (missing.length > 0)
		return missing.map((message) =>
			limitError(
				message,
				limit,
				'Pass one of its slicing arguments with a non-negative integer, or set requireOneSlicingArgument: false on its @listSize.',
				operation,
			),
		);
	if (cost <= options.max) return undefined;
	return [
		limitError(
			`Operation cost ${cost} exceeds the limit of ${options.max}.`,
			limit,
			'Request fewer items (use the slicing arguments, such as first) or raise limits.cost.max.',
			operation,
		),
	];
}
