import {
	type ConstDirectiveNode,
	type GraphQLArgument,
	type GraphQLField,
	type GraphQLInputField,
	type GraphQLInterfaceType,
	type GraphQLObjectType,
	valueFromASTUntyped,
} from 'graphql';
import type { GraxiaErrorCode } from '../errors/codes';

/** The limits `@constraint` declares on an input value. */
export interface Constraint {
	minLength?: number;
	maxLength?: number;
	min?: number;
	max?: number;
	exclusiveMin?: number;
	exclusiveMax?: number;
	multipleOf?: number;
	minItems?: number;
	maxItems?: number;
	pattern?: string;
	format?: string;
}

/** One requirement of `@needs`: a permission, or any of several. */
export type Need = string | { anyOf: readonly string[] };

/** An error code: a known one (autocompleted) or any string. */
export type ErrorCodeName = GraxiaErrorCode | (string & {});

/** What a code-built schema puts under `extensions.graxia` instead of directives. */
export interface AgentExtensions {
	/** What is needed (`@needs`): a permission, any of a list, or several of those (all required). */
	needs?: Need | readonly Need[];
	/** The limits of an argument or input field (`@constraint`). */
	constraint?: Constraint;
	/** The error code(s) a field may return (`@errors`). */
	errors?: ErrorCodeName | readonly ErrorCodeName[];
}

/** What `@needs` applies to: a field, an object or an interface. */
export type NeedsTarget =
	| GraphQLField<any, any>
	| GraphQLObjectType
	| GraphQLInterfaceType;
/** What `@constraint` applies to: an argument or an input field. */
export type ConstraintTarget = GraphQLArgument | GraphQLInputField;

/**
 * Makes the `extensions` of a type, field, argument or input field built in
 * code carry agent metadata, typed: `extensions: agentExtensions({ needs: 'books:write' })`.
 */
export function agentExtensions(agent: AgentExtensions): {
	graxia: AgentExtensions;
} {
	return { graxia: agent };
}

interface Carrier {
	directives?: readonly ConstDirectiveNode[] | undefined;
}
type Element = {
	astNode?: Carrier | null | undefined;
	extensionASTNodes?: readonly Carrier[];
	extensions?: unknown;
};

/** The arguments of every use of directive `name` on the element, from its AST and its extension nodes. */
function uses(element: Element, name: string): Record<string, unknown>[] {
	const nodes = [element.astNode, ...(element.extensionASTNodes ?? [])];
	return nodes
		.flatMap((node) => node?.directives ?? [])
		.filter((directive) => directive.name.value === name)
		.map((directive) =>
			Object.fromEntries(
				(directive.arguments ?? []).map((arg) => [
					arg.name.value,
					valueFromASTUntyped(arg.value),
				]),
			),
		);
}

const fromExtensions = (element: Element): AgentExtensions =>
	(element.extensions as { graxia?: AgentExtensions } | undefined)?.graxia ??
	{};

const unique = (values: readonly string[]): string[] => [...new Set(values)];

/** The permissions of a code-built `{ anyOf }`, or `undefined` when it is not a non-empty list of strings. */
function codeAnyOf(need: unknown): string[] | undefined {
	const any = (need as { anyOf?: unknown } | null)?.anyOf;
	return Array.isArray(any) &&
		any.length > 0 &&
		any.every((p) => typeof p === 'string')
		? (any as string[])
		: undefined;
}

/**
 * What `@needs` (or `extensions.graxia.needs`) asks of a caller for a field or
 * type: a list of requirements that are ANDed, each an any-of list of
 * permissions (`permission: "a"` is `["a"]`, `anyOf: ["a", "b"]` is
 * `["a", "b"]`). Empty when it asks for none. A use that gives both arguments
 * or neither is invalid and reads as an empty any-of, which no caller meets
 * (the field stays hidden); `lintDescriptions` reports it as `invalid-needs`.
 */
export function needsOf(target: NeedsTarget): string[][] {
	const declared = fromExtensions(target).needs;
	const fromCode: Need[] =
		declared === undefined
			? []
			: Array.isArray(declared)
				? [...declared]
				: [declared as Need];
	const groups = [
		...uses(target, 'needs').map((use): string[] => {
			const one = use['permission'];
			const any = use['anyOf'];
			if (typeof one === 'string' && any == null) return [one];
			if (one == null && Array.isArray(any) && any.length > 0)
				return unique(any.map(String));
			return [];
		}),
		...fromCode.map((need): string[] =>
			typeof need === 'string'
				? [need]
				: codeAnyOf(need) === undefined
					? []
					: unique(codeAnyOf(need) ?? []),
		),
	];
	const seen = new Set<string>();
	return groups.filter((group) => {
		const key = JSON.stringify([...group].sort());
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

/** Whether some `@needs` use of the target gives both arguments or neither. */
export function hasInvalidNeeds(target: NeedsTarget): boolean {
	const declared = fromExtensions(target).needs;
	const fromCode: unknown[] =
		declared === undefined
			? []
			: Array.isArray(declared)
				? declared
				: [declared];
	return (
		uses(target, 'needs').some((use) => {
			const hasOne = typeof use['permission'] === 'string';
			const hasAny = Array.isArray(use['anyOf']) && use['anyOf'].length > 0;
			return hasOne === hasAny;
		}) ||
		fromCode.some(
			(need) => typeof need !== 'string' && codeAnyOf(need) === undefined,
		)
	);
}

/** The limits `@constraint` (or `extensions.graxia.constraint`) declares, or `undefined`. */
export function constraintOf(target: ConstraintTarget): Constraint | undefined {
	const [use] = uses(target, 'constraint');
	const merged = { ...fromExtensions(target).constraint, ...use };
	return Object.keys(merged).length > 0 ? (merged as Constraint) : undefined;
}

/** The error codes `@errors` (or `extensions.graxia.errors`) lists for a field. */
export function errorsOf(field: GraphQLField<any, any>): string[] {
	return unique([
		...uses(field, 'errors').flatMap((use) => (use['codes'] as string[]) ?? []),
		...[fromExtensions(field).errors ?? []].flat(),
	]);
}
