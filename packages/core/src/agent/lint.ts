import {
	type GraphQLArgument,
	type GraphQLField,
	type GraphQLNamedType,
	type GraphQLSchema,
	isEnumType,
	isInputObjectType,
	isInterfaceType,
	isIntrospectionType,
	isObjectType,
	isScalarType,
	isSpecifiedScalarType,
} from 'graphql';
import { type ErrorCodeName, errorsOf, hasInvalidNeeds } from './read';
import { restatesName } from './words';

/** The name of a rule of {@link lintDescriptions}. */
export type LintRule =
	| 'missing-description'
	| 'short-description'
	| 'name-only-description'
	| 'unknown-error-code'
	| 'mutation-without-errors'
	| 'invalid-needs';

/** One finding: where, which rule, what is wrong and how to fix it. */
export interface LintIssue {
	/** The schema coordinate: `Type`, `Type.field`, `Type.field(arg:)`, `Enum.VALUE`, `Input.field`. */
	coordinate: string;
	rule: LintRule;
	message: string;
	fix: string;
}

/** Which kinds of definition must have a description. All default to `true`. */
export interface RequiredDescriptions {
	types?: boolean;
	fields?: boolean;
	arguments?: boolean;
	enumValues?: boolean;
	inputFields?: boolean;
}

/** Options of {@link lintDescriptions}. */
export interface LintDescriptionsOptions {
	/** The shortest description that is not flagged; 12 by default. */
	minLength?: number;
	/** Which definitions need a description; all do by default. */
	require?: RequiredDescriptions;
	/**
	 * The error codes the API may return. When set, a code in `@errors` outside
	 * it is an `unknown-error-code`, and a mutation without `@errors` is a
	 * `mutation-without-errors`.
	 */
	knownErrorCodes?: readonly ErrorCodeName[];
}

const DEFAULT_MIN_LENGTH = 12;

interface Described {
	name: string;
	description?: string | null | undefined;
}

/** The issues of one definition's description, at most one. */
function checkDescription(
	coordinate: string,
	kind: string,
	item: Described,
	minLength: number,
	required: boolean,
): LintIssue[] {
	const text = item.description?.trim() ?? '';
	if (text === '')
		return required
			? [
					{
						coordinate,
						rule: 'missing-description',
						message: `${coordinate} has no description.`,
						fix: `Add a description to the ${kind} ${coordinate}: say what it is for and when it is used.`,
					},
				]
			: [];
	if (restatesName(item.name, text))
		return [
			{
				coordinate,
				rule: 'name-only-description',
				message: `The description of ${coordinate} only repeats its name.`,
				fix: `Say what ${coordinate} means for a caller (its unit, format, limits or effect), not its name again.`,
			},
		];
	if (text.length < minLength)
		return [
			{
				coordinate,
				rule: 'short-description',
				message: `The description of ${coordinate} is ${text.length} characters, under ${minLength}.`,
				fix: `Write at least ${minLength} characters for ${coordinate}: what it is, and what the caller must know to use it.`,
			},
		];
	return [];
}

/** The description a field takes from the interface field it implements, when it has none. */
function inherited(
	type: GraphQLNamedType,
	field: GraphQLField<any, any>,
): string | undefined {
	if (!isObjectType(type) && !isInterfaceType(type)) return undefined;
	for (const iface of type.getInterfaces()) {
		const text = iface.getFields()[field.name]?.description;
		if (text) return text;
	}
	return undefined;
}

const invalidNeeds = (coordinate: string): LintIssue => ({
	coordinate,
	rule: 'invalid-needs',
	message: `@needs on ${coordinate} gives both permission and anyOf, or neither (or an empty anyOf).`,
	fix: 'Give @needs exactly one of permission: "x" or anyOf: ["x", "y"]; repeat @needs to require several.',
});

function lintField(
	type: GraphQLNamedType,
	field: GraphQLField<any, any>,
	options: Required<Pick<LintDescriptionsOptions, 'minLength'>> &
		LintDescriptionsOptions,
	required: Required<RequiredDescriptions>,
	isMutation: boolean,
): LintIssue[] {
	const coordinate = `${type.name}.${field.name}`;
	const known = options.knownErrorCodes;
	const codes = errorsOf(field);
	const issues: LintIssue[] = [
		...checkDescription(
			coordinate,
			'field',
			{
				name: field.name,
				description: field.description ?? inherited(type, field),
			},
			options.minLength,
			required.fields,
		),
		...field.args.flatMap((arg: GraphQLArgument) =>
			checkDescription(
				`${coordinate}(${arg.name}:)`,
				'argument',
				arg,
				options.minLength,
				required.arguments,
			),
		),
	];
	if (hasInvalidNeeds(field)) issues.push(invalidNeeds(coordinate));
	if (!known) return issues;
	for (const code of codes.filter((c) => !known.includes(c)))
		issues.push({
			coordinate,
			rule: 'unknown-error-code',
			message: `@errors on ${coordinate} lists ${code}, which is not a known error code.`,
			fix: `Use one of the known codes (${known.join(', ')}), or add ${code} to knownErrorCodes.`,
		});
	if (isMutation && codes.length === 0)
		issues.push({
			coordinate,
			rule: 'mutation-without-errors',
			message: `The mutation ${coordinate} does not say which errors it may return.`,
			fix: `Add @errors(codes: [...]) to ${coordinate} with the codes a caller can get.`,
		});
	return issues;
}

function lintType(
	schema: GraphQLSchema,
	type: GraphQLNamedType,
	options: Required<Pick<LintDescriptionsOptions, 'minLength'>> &
		LintDescriptionsOptions,
	required: Required<RequiredDescriptions>,
): LintIssue[] {
	const issues = checkDescription(
		type.name,
		'type',
		type,
		options.minLength,
		required.types,
	);
	if ((isObjectType(type) || isInterfaceType(type)) && hasInvalidNeeds(type))
		issues.push(invalidNeeds(type.name));
	if (isObjectType(type) || isInterfaceType(type))
		for (const field of Object.values(type.getFields()))
			issues.push(
				...lintField(
					type,
					field,
					options,
					required,
					type === schema.getMutationType(),
				),
			);
	else if (isInputObjectType(type))
		for (const field of Object.values(type.getFields()))
			issues.push(
				...checkDescription(
					`${type.name}.${field.name}`,
					'input field',
					field,
					options.minLength,
					required.inputFields,
				),
			);
	else if (isEnumType(type))
		for (const value of type.getValues())
			issues.push(
				...checkDescription(
					`${type.name}.${value.name}`,
					'enum value',
					value,
					options.minLength,
					required.enumValues,
				),
			);
	return issues;
}

/**
 * Checks that a schema describes itself well enough for an agent to use it:
 * a description on every type, field, argument, enum value and input field,
 * long enough and not only the name again. With `knownErrorCodes`, it also
 * checks `@errors`. Introspection types, built-in scalars and directive
 * definitions are skipped. Issues come sorted by coordinate and carry a `fix`.
 *
 * @example
 * test('the schema is described', () => {
 *   expect(lintDescriptions(schema)).toEqual([]);
 * });
 */
export function lintDescriptions(
	schema: GraphQLSchema,
	options: LintDescriptionsOptions = {},
): LintIssue[] {
	const resolved = {
		...options,
		minLength: options.minLength ?? DEFAULT_MIN_LENGTH,
	};
	const required: Required<RequiredDescriptions> = {
		types: true,
		fields: true,
		arguments: true,
		enumValues: true,
		inputFields: true,
		...options.require,
	};
	return Object.values(schema.getTypeMap())
		.filter(
			(type) =>
				!isIntrospectionType(type) &&
				!(isScalarType(type) && isSpecifiedScalarType(type)),
		)
		.flatMap((type) => lintType(schema, type, resolved, required))
		.sort(
			(a, b) =>
				(a.coordinate < b.coordinate
					? -1
					: a.coordinate > b.coordinate
						? 1
						: 0) || (a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0),
		);
}
