import { GraxiaConfigError } from '../errors/config-error';

/** The `limits.cost` option: the cost an operation may have, and how it is counted. */
export interface CostOptions {
	/** The highest cost an operation may have. 5 000 by default. */
	max?: number;
	/** Items assumed in a list field with no `@listSize` and no slicing argument. 10 by default. */
	defaultListSize?: number;
	/** Cost of an object returned by a field with no `@cost`. 1 by default. */
	objectCost?: number;
	/** Cost of a scalar or enum returned by a field with no `@cost`. 0 by default. */
	scalarCost?: number;
}

/** Limits that need the operation (and, for `cost`, the schema and variables). `false` turns one off. */
export interface OperationLimits {
	/** The deepest field selection, fragments expanded. 12 by default. */
	depth?: number | false;
	/** The most aliased fields, fragments expanded. 30 by default. */
	aliases?: number | false;
	/** The most directive usages, fragments expanded. 50 by default. */
	directives?: number | false;
	/** The most root fields, fragments expanded. 20 by default. */
	rootFields?: number | false;
	/** The cost limit, or `false`. On by default with {@link CostOptions} defaults. */
	cost?: false | CostOptions;
}

/** Default {@link OperationLimits.depth}. */
export const DEFAULT_MAX_DEPTH = 12;
/** Default {@link OperationLimits.aliases}. */
export const DEFAULT_MAX_ALIASES = 30;
/** Default {@link OperationLimits.directives}. */
export const DEFAULT_MAX_DIRECTIVES = 50;
/** Default {@link OperationLimits.rootFields}. */
export const DEFAULT_MAX_ROOT_FIELDS = 20;
/** Default {@link CostOptions.max}. */
export const DEFAULT_MAX_COST = 5_000;
/** Default {@link CostOptions.defaultListSize}. */
export const DEFAULT_LIST_SIZE = 10;

/** The cost settings with their defaults applied. */
export type ResolvedCost = Required<CostOptions>;

/** {@link OperationLimits} with their defaults applied and validated. */
export interface ResolvedOperationLimits {
	readonly depth: number | false;
	readonly aliases: number | false;
	readonly directives: number | false;
	readonly rootFields: number | false;
	readonly cost: ResolvedCost | false;
}

const positive = (value: unknown): value is number =>
	typeof value === 'number' && Number.isInteger(value) && value >= 1;

const nonNegative = (value: unknown): value is number =>
	typeof value === 'number' && Number.isInteger(value) && value >= 0;

function count(
	name: string,
	value: number | false | undefined,
	fallback: number,
): number | false {
	if (value === undefined) return fallback;
	if (value === false || positive(value)) return value;
	throw new GraxiaConfigError(
		`limits.${name} must be a positive integer (or false)`,
	);
}

/** Resolves the cost settings of `options` over the defaults, without the limit itself. */
export function resolveCostOptions(options: CostOptions = {}): ResolvedCost {
	const { max = DEFAULT_MAX_COST, defaultListSize = DEFAULT_LIST_SIZE } =
		options;
	const { objectCost = 1, scalarCost = 0 } = options;
	if (!positive(max))
		throw new GraxiaConfigError('limits.cost.max must be a positive integer');
	if (!positive(defaultListSize))
		throw new GraxiaConfigError(
			'limits.cost.defaultListSize must be a positive integer',
		);
	if (!nonNegative(objectCost))
		throw new GraxiaConfigError(
			'limits.cost.objectCost must be a non-negative integer',
		);
	if (!nonNegative(scalarCost))
		throw new GraxiaConfigError(
			'limits.cost.scalarCost must be a non-negative integer',
		);
	return { max, defaultListSize, objectCost, scalarCost };
}

/**
 * Applies the defaults of {@link OperationLimits}.
 * @throws {GraxiaConfigError} when a limit is not a positive integer (or `false`).
 */
export function resolveOperationLimits(
	limits: OperationLimits = {},
): ResolvedOperationLimits {
	const { cost } = limits;
	if (
		cost !== undefined &&
		cost !== false &&
		(typeof cost !== 'object' || cost === null)
	)
		throw new GraxiaConfigError(
			'limits.cost must be false or an object ({ max, defaultListSize, objectCost, scalarCost })',
		);
	return {
		depth: count('depth', limits.depth, DEFAULT_MAX_DEPTH),
		aliases: count('aliases', limits.aliases, DEFAULT_MAX_ALIASES),
		directives: count('directives', limits.directives, DEFAULT_MAX_DIRECTIVES),
		rootFields: count('rootFields', limits.rootFields, DEFAULT_MAX_ROOT_FIELDS),
		cost: cost === false ? false : resolveCostOptions(cost),
	};
}
