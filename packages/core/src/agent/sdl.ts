import {
	astFromValue,
	DEFAULT_DEPRECATION_REASON,
	type GraphQLArgument,
	type GraphQLInputField,
	type GraphQLInputType,
	Kind,
	print,
} from 'graphql';
import { type AgentDirectiveName, directiveSDL } from './directives';
import {
	type Constraint,
	constraintOf,
	errorsOf,
	type NeedsTarget,
	needsOf,
} from './read';

/** A string literal, as GraphQL writes it. */
export const literal = (value: string): string =>
	print({ kind: Kind.STRING, value });

/** Whether `text` reads fine as a block string: several lines, no edge whitespace. */
const isBlockSafe = (text: string): boolean =>
	text.includes('\n') && text === text.trim();

/** The description of a definition, as lines that end with a newline (empty when it has none). */
export function describe(
	description: string | null | undefined,
	indent = '',
): string {
	if (description == null || description === '') return '';
	const text = print({
		kind: Kind.STRING,
		value: description,
		block: isBlockSafe(description),
	});
	return indent + text.replaceAll('\n', `\n${indent}`) + '\n';
}

/** ` @deprecated(reason: "...")`, or nothing. */
export function deprecated(reason: string | null | undefined): string {
	if (reason == null) return '';
	return reason === DEFAULT_DEPRECATION_REASON
		? ' @deprecated'
		: ` @deprecated(reason: ${literal(reason)})`;
}

/** The directives of a field or type that graxia reads, ready to append. */
export function applied(
	target: NeedsTarget,
	used: Set<AgentDirectiveName>,
	withErrors: boolean,
): string {
	const needs = needsOf(target).map((anyOf) =>
		anyOf.length === 1
			? ` @needs(permission: ${literal(anyOf[0] as string)})`
			: ` @needs(anyOf: [${anyOf.map(literal).join(', ')}])`,
	);
	if (needs.length > 0) used.add('needs');
	const codes = withErrors && 'args' in target ? errorsOf(target) : [];
	if (codes.length > 0) used.add('errors');
	return (
		needs.join('') +
		(codes.length > 0
			? ` @errors(codes: [${codes.map(literal).join(', ')}])`
			: '')
	);
}

const constraintArgs = (c: Constraint): string =>
	Object.entries(c)
		.map(
			([key, value]) =>
				`${key}: ${typeof value === 'string' ? literal(value) : String(value)}`,
		)
		.join(', ');

/**
 * The default of an argument or input field as an AST: graphql 17's
 * `default` (`{ literal }` or `{ value }`), or the `defaultValue` a schema
 * built in code may still carry (a coerced value, written with `astFromValue`).
 */
function defaultAST(value: GraphQLArgument | GraphQLInputField) {
	const dflt = value.default;
	if (dflt && 'literal' in dflt && dflt.literal) return dflt.literal;
	const coerced: { value: unknown } | undefined = dflt
		? { value: (dflt as { value: unknown }).value }
		: (value as { defaultValue?: unknown }).defaultValue !== undefined
			? { value: (value as { defaultValue?: unknown }).defaultValue }
			: undefined;
	return coerced
		? astFromValue(coerced.value, value.type as GraphQLInputType)
		: undefined;
}

/** `name: Type = default @constraint(...) @deprecated`, for an argument or an input field. */
export function inputValue(
	value: GraphQLArgument | GraphQLInputField,
	used: Set<AgentDirectiveName>,
): string {
	let out = `${value.name}: ${String(value.type)}`;
	const ast = defaultAST(value);
	if (ast) out += ` = ${print(ast)}`;
	const constraint = constraintOf(value);
	if (constraint) {
		used.add('constraint');
		out += ` @constraint(${constraintArgs(constraint)})`;
	}
	return out + deprecated(value.deprecationReason);
}

/** `(a: Int, b: String)`, on one line or one argument per line when any has a description. */
export function printArgs(
	args: readonly GraphQLArgument[],
	used: Set<AgentDirectiveName>,
	indent: string,
): string {
	if (args.length === 0) return '';
	if (args.every((arg) => arg.description == null))
		return `(${args.map((arg) => inputValue(arg, used)).join(', ')})`;
	const inner = `${indent}  `;
	return `(\n${args
		.map(
			(arg) => describe(arg.description, inner) + inner + inputValue(arg, used),
		)
		.join('\n')}\n${indent})`;
}

/** The definitions of the agent directives that the printed schema uses. */
export const directiveDefinitions = (used: ReadonlySet<AgentDirectiveName>) =>
	(Object.keys(directiveSDL) as AgentDirectiveName[])
		.filter((name) => used.has(name))
		.map((name) => directiveSDL[name]);
