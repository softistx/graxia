import {
	buildSchema,
	type GraphQLEnumType,
	type GraphQLInputObjectType,
	type GraphQLInterfaceType,
	type GraphQLNamedType,
	type GraphQLObjectType,
	type GraphQLScalarType,
	type GraphQLSchema,
	type GraphQLUnionType,
	isEnumType,
	isInputObjectType,
	isInterfaceType,
	isObjectType,
	isScalarType,
	isSpecifiedScalarType,
	isUnionType,
} from 'graphql';
import type { AgentDirectiveName } from './directives';
import {
	applied,
	deprecated,
	describe,
	directiveDefinitions,
	inputValue,
	literal,
	printArgs,
} from './sdl';
import { type Can, type View, visibleView } from './visible';

/** Options of {@link printSchemaFor}. */
export interface PrintSchemaForOptions {
	/**
	 * Whether the caller holds a permission named by `@needs`. Absent: every
	 * field and type is visible. A `@needs` with `anyOf` is met by one of its
	 * permissions; repeated `@needs` must all be met.
	 */
	can?: Can;
}

type Used = Set<AgentDirectiveName>;

function printFields(
	type: GraphQLObjectType | GraphQLInterfaceType,
	view: View,
	used: Used,
): string {
	const kept = view.fields.get(type.name);
	return Object.values(type.getFields())
		.filter((field) => kept?.has(field.name))
		.map(
			(field, i) =>
				describe(field.description, '  ').replace(
					/^/,
					i > 0 && field.description ? '\n' : '',
				) +
				`  ${field.name}${printArgs(field.args, used, '  ')}: ${String(field.type)}` +
				deprecated(field.deprecationReason) +
				applied(field, used, true),
		)
		.join('\n');
}

function printComposite(
	keyword: 'type' | 'interface',
	type: GraphQLObjectType | GraphQLInterfaceType,
	view: View,
	used: Used,
): string {
	const ifaces = view.interfaces.get(type.name) ?? [];
	return (
		describe(type.description) +
		`${keyword} ${type.name}` +
		(ifaces.length > 0 ? ` implements ${ifaces.join(' & ')}` : '') +
		applied(type, used, false) +
		` {\n${printFields(type, view, used)}\n}`
	);
}

function printInput(type: GraphQLInputObjectType, used: Used): string {
	const fields = Object.values(type.getFields()).map(
		(field) =>
			describe(field.description, '  ') + `  ${inputValue(field, used)}`,
	);
	return (
		describe(type.description) +
		`input ${type.name}${type.isOneOf ? ' @oneOf' : ''} {\n${fields.join('\n')}\n}`
	);
}

function printEnum(type: GraphQLEnumType): string {
	const values = type
		.getValues()
		.map(
			(value) =>
				describe(value.description, '  ') +
				`  ${value.name}${deprecated(value.deprecationReason)}`,
		);
	return `${describe(type.description)}enum ${type.name} {\n${values.join('\n')}\n}`;
}

const printScalar = (type: GraphQLScalarType): string =>
	`${describe(type.description)}scalar ${type.name}` +
	(type.specifiedByURL
		? ` @specifiedBy(url: ${literal(type.specifiedByURL)})`
		: '');

function printUnion(type: GraphQLUnionType, view: View): string {
	return `${describe(type.description)}union ${type.name} = ${(view.members.get(type.name) ?? []).join(' | ')}`;
}

const PLACEHOLDER_DESCRIPTION =
	'Placeholder: no query field is visible to this caller.';

/** The Query a caller with no visible query field gets: one placeholder field, so the schema stays valid. */
const printPlaceholder = (name: string): string =>
	`type ${name} {\n${describe(PLACEHOLDER_DESCRIPTION, '  ')}  _empty: Boolean\n}`;

function printType(type: GraphQLNamedType, view: View, used: Used): string {
	if (view.placeholder === type.name) return printPlaceholder(type.name);
	if (isObjectType(type)) return printComposite('type', type, view, used);
	if (isInterfaceType(type))
		return printComposite('interface', type, view, used);
	if (isInputObjectType(type)) return printInput(type, used);
	if (isEnumType(type)) return printEnum(type);
	if (isUnionType(type)) return printUnion(type, view);
	return printScalar(type as GraphQLScalarType);
}

/** `schema { ... }` when the roots are not the conventional ones, else nothing. */
function printSchemaBlock(view: View): string {
	const { query, mutation, subscription } = view.roots;
	const conventional =
		query === 'Query' &&
		(mutation === undefined || mutation === 'Mutation') &&
		(subscription === undefined || subscription === 'Subscription');
	if (conventional) return '';
	return `schema {\n${(['query', 'mutation', 'subscription'] as const)
		.filter((key) => view.roots[key])
		.map((key) => `  ${key}: ${view.roots[key]}`)
		.join('\n')}\n}`;
}

/**
 * The schema as SDL for a caller: what `@needs` hides from them is left out,
 * and so is what that leaves empty or unreachable (see the agent guide). It
 * keeps descriptions, `@deprecated`, `@specifiedBy`, `@oneOf` and the applied
 * `@needs`, `@constraint` and `@errors`, and it declares the agent directives
 * it uses, so `buildSchema(output)` works. Introspection types, built-in
 * scalars, `@defer` and `@stream` are not printed; types come in the
 * schema's own order. When no Query field is visible, the Query type keeps one placeholder field
 * (`_empty: Boolean`), so the output is always a valid schema.
 *
 * It walks the whole schema: call it once per kind of principal and keep the
 * text, not once per request.
 *
 * @example
 * const sdl = printSchemaFor(schema, { can: (p) => principal.permissions.has(p) });
 */
export function printSchemaFor(
	schema: GraphQLSchema,
	options: PrintSchemaForOptions = {},
): string {
	const view = visibleView(schema, options.can ?? (() => true));
	const used: Used = new Set();
	const blocks = Object.values(schema.getTypeMap())
		.filter(
			(type) =>
				view.types.has(type.name) &&
				!(isScalarType(type) && isSpecifiedScalarType(type)),
		)
		.map((type) => printType(type, view, used));
	if (view.placeholder && !schema.getType(view.placeholder))
		blocks.unshift(printPlaceholder(view.placeholder));
	const all = [
		printSchemaBlock(view),
		...directiveDefinitions(used),
		...blocks,
	].filter((block) => block !== '');
	return `${all.join('\n\n')}\n`;
}

/**
 * The schema a caller may see, as a valid `GraphQLSchema` (the same view
 * {@link printSchemaFor} prints; the schema is built from that text, so it
 * carries the directives but no resolvers). Validate and describe operations
 * against it: a field the caller cannot see is unknown to it.
 *
 * @example
 * const visible = visibleSchema(schema, { can: (p) => permissions.has(p) });
 * const errors = validate(visible, parse(query));
 */
export function visibleSchema(
	schema: GraphQLSchema,
	options: PrintSchemaForOptions = {},
): GraphQLSchema {
	return buildSchema(printSchemaFor(schema, options));
}
