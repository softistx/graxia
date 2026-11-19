import {
	type ConstDirectiveNode,
	type GraphQLArgument,
	type GraphQLField,
	type GraphQLInputField,
	type GraphQLInterfaceType,
	type GraphQLObjectType,
	valueFromASTUntyped,
} from 'graphql';

/** The limits `@constraint` declares on an input value. */
export interface Constraint {
	minLength?: number;
	maxLength?: number;
	min?: number;
	max?: number;
	pattern?: string;
	format?: string;
}

/** What a code-built schema puts under `extensions.graxia` instead of directives. */
export interface AgentExtensions {
	/** The permission(s) needed, all of them (`@needs`). */
	needs?: string | readonly string[];
	/** The limits of an argument or input field (`@constraint`). */
	constraint?: Constraint;
	/** The error codes a field may return (`@errors`). */
	errors?: readonly string[];
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

/**
 * The permissions `@needs` (or `extensions.graxia.needs`) asks of a caller for
 * a field or type; all of them are required. Empty when it asks for none.
 */
export function needsOf(target: NeedsTarget): string[] {
	const declared = fromExtensions(target).needs ?? [];
	return unique([
		...uses(target, 'needs').map((use) => String(use['permission'])),
		...(typeof declared === 'string' ? [declared] : declared),
	]);
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
		...(fromExtensions(field).errors ?? []),
	]);
}
