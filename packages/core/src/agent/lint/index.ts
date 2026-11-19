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
import { hasInvalidNeeds } from '../read';
import { checkDescription, inherited } from './descriptions';
import { lintErrorCodes } from './error-codes';
import { invalidNeeds } from './needs';
import type {
	LintDescriptionsOptions,
	LintIssue,
	RequiredDescriptions,
} from './types';

export type {
	LintDescriptionsOptions,
	LintIssue,
	LintRule,
	RequiredDescriptions,
} from './types';

const DEFAULT_MIN_LENGTH = 12;

function lintField(
	type: GraphQLNamedType,
	field: GraphQLField<any, any>,
	options: Required<Pick<LintDescriptionsOptions, 'minLength'>> &
		LintDescriptionsOptions,
	required: Required<RequiredDescriptions>,
	isMutation: boolean,
): LintIssue[] {
	const coordinate = `${type.name}.${field.name}`;
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
	issues.push(
		...lintErrorCodes(coordinate, field, options.knownErrorCodes, isMutation),
	);
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
