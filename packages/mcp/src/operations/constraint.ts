import type { Constraint } from '@softistx/graxia/agent';
import type { JsonSchema } from './types';

/** `@constraint` argument to JSON Schema keyword, for a string or a number. */
const LEAF: Readonly<Partial<Record<keyof Constraint, string>>> = {
	minLength: 'minLength',
	maxLength: 'maxLength',
	min: 'minimum',
	max: 'maximum',
	exclusiveMin: 'exclusiveMinimum',
	exclusiveMax: 'exclusiveMaximum',
	multipleOf: 'multipleOf',
	pattern: 'pattern',
	format: 'format',
};
/** `@constraint` argument to JSON Schema keyword, for a list. */
const LIST: Readonly<Partial<Record<keyof Constraint, string>>> = {
	minItems: 'minItems',
	maxItems: 'maxItems',
};

const LOWER = ['minLength', 'min', 'exclusiveMin', 'minItems'] as const;
const UPPER = ['maxLength', 'max', 'exclusiveMax', 'maxItems'] as const;
const EXACT = ['multipleOf', 'pattern', 'format'] as const;

const isArray = (node: JsonSchema): boolean =>
	node['type'] === 'array' ||
	(Array.isArray(node['type']) && node['type'].includes('array'));

function keywords(
	constraint: Constraint,
	map: Readonly<Partial<Record<keyof Constraint, string>>>,
): JsonSchema {
	const out: JsonSchema = {};
	for (const [key, keyword] of Object.entries(map)) {
		const value = constraint[key as keyof Constraint];
		if (value !== undefined && value !== null) out[keyword] = value;
	}
	return out;
}

/**
 * The schema `node` with the limits of `constraint`. On a list, `minItems`
 * and `maxItems` go on the outermost array and the other limits on its
 * innermost items; on a reference or a union nothing is added.
 */
export function constrained(
	node: JsonSchema,
	constraint: Constraint | undefined,
): JsonSchema {
	if (!constraint) return node;
	if (isArray(node))
		return {
			...node,
			...keywords(constraint, LIST),
			items: leafConstrained(node['items'] as JsonSchema, constraint),
		};
	return leafConstrained(node, constraint);
}

function leafConstrained(node: JsonSchema, constraint: Constraint): JsonSchema {
	if (isArray(node))
		return {
			...node,
			items: leafConstrained(node['items'] as JsonSchema, constraint),
		};
	if ('$ref' in node || 'anyOf' in node) return node;
	return { ...node, ...keywords(constraint, LEAF) };
}

/**
 * One constraint a value must meet to satisfy all of `constraints` (a
 * variable used at several arguments): the tightest bound of each kind;
 * `pattern`, `format` and `multipleOf` are kept when the usages that declare
 * one agree, and dropped when they differ (graxia's own checks still apply).
 */
export function tightest(
	constraints: readonly Constraint[],
): Constraint | undefined {
	if (constraints.length === 0) return undefined;
	const out: Record<string, unknown> = {};
	const values = <K extends keyof Constraint>(key: K) =>
		constraints
			.map((c) => c[key])
			.filter((v): v is NonNullable<Constraint[K]> => v != null);
	for (const key of LOWER)
		if (values(key).length > 0) out[key] = Math.max(...values(key));
	for (const key of UPPER)
		if (values(key).length > 0) out[key] = Math.min(...values(key));
	for (const key of EXACT) {
		const distinct = new Set<unknown>(values(key));
		if (distinct.size === 1) out[key] = [...distinct][0];
	}
	return Object.keys(out).length > 0 ? (out as Constraint) : undefined;
}
