import { constraintOf } from '@graxia/core/agent';
import {
	type GraphQLEnumType,
	type GraphQLInputField,
	type GraphQLInputObjectType,
	type GraphQLInputType,
	isEnumType,
	isInputObjectType,
	isListType,
	isNonNullType,
	isRequiredInputField,
	valueFromASTUntyped,
} from 'graphql';
import { constrained } from './constraint';
import type { JsonSchema } from './types';

/** The `$defs` of one input schema: every input object the variables reach, by type name. Make it with {@link newDefs}. */
export type Defs = Record<string, JsonSchema>;

/** An empty {@link Defs}, without a prototype: a type may be named `constructor` or `toString`. */
export const newDefs = (): Defs => Object.create(null) as Defs;

/** The JSON type of each built-in scalar. */
export const SCALARS: Readonly<Record<string, string>> = {
	Int: 'integer',
	Float: 'number',
	String: 'string',
	ID: 'string',
	Boolean: 'boolean',
};

const described = (description: string | null | undefined): JsonSchema =>
	description ? { description } : {};

/** An enum as its value names; the description lists the values that have one. */
export function enumSchema(type: GraphQLEnumType): JsonSchema {
	const values = type.getValues();
	const lines = values
		.filter((value) => value.description)
		.map((value) => `- ${value.name}: ${value.description}`);
	const description = [type.description, ...lines].filter(Boolean).join('\n');
	return {
		type: 'string',
		enum: values.map((value) => value.name),
		...described(description),
	};
}

/** The same schema, accepting `null` too. */
export function nullable(node: JsonSchema): JsonSchema {
	if ('$ref' in node) return { anyOf: [node, { type: 'null' }] };
	if (typeof node['type'] !== 'string') return node;
	return {
		...node,
		type: [node['type'], 'null'],
		...(Array.isArray(node['enum']) ? { enum: [...node['enum'], null] } : {}),
	};
}

/** The default of an input field, when it declares one. */
function defaultOf(field: GraphQLInputField): { default?: unknown } {
	const declared = field.default;
	if (declared?.literal)
		return { default: valueFromASTUntyped(declared.literal) };
	if (declared && 'value' in declared) return { default: declared.value };
	// Code-first schemas (and graphql 16's) set `defaultValue`.
	if (field.defaultValue !== undefined) return { default: field.defaultValue };
	return {};
}

function fieldSchema(field: GraphQLInputField, defs: Defs): JsonSchema {
	return {
		...constrained(typeSchema(field.type, defs), constraintOf(field)),
		...described(field.description),
		...defaultOf(field),
		...(field.deprecationReason ? { deprecated: true } : {}),
	};
}

function objectSchema(type: GraphQLInputObjectType, defs: Defs): JsonSchema {
	const fields = Object.values(type.getFields());
	if (type.isOneOf)
		return {
			type: 'object',
			...described(type.description),
			oneOf: fields.map((field) => ({
				properties: {
					[field.name]: {
						...constrained(valueSchema(field.type, defs), constraintOf(field)),
						...described(field.description),
					},
				},
				required: [field.name],
				additionalProperties: false,
			})),
		};
	const required = fields.filter(isRequiredInputField).map((f) => f.name);
	return {
		type: 'object',
		...described(type.description),
		properties: Object.fromEntries(
			fields.map((field) => [field.name, fieldSchema(field, defs)]),
		),
		...(required.length > 0 ? { required } : {}),
		additionalProperties: false,
	};
}

/** The schema of a value of `type` that is not `null`. */
function valueSchema(type: GraphQLInputType, defs: Defs): JsonSchema {
	if (isNonNullType(type)) return valueSchema(type.ofType, defs);
	if (isListType(type))
		return { type: 'array', items: typeSchema(type.ofType, defs) };
	if (isEnumType(type)) return enumSchema(type);
	if (isInputObjectType(type)) {
		if (!Object.hasOwn(defs, type.name)) {
			// Reserved before it is filled, so a recursive input type ends on its own $ref.
			defs[type.name] = {};
			defs[type.name] = objectSchema(type, defs);
		}
		return { $ref: `#/$defs/${type.name}` };
	}
	const builtIn = SCALARS[type.name];
	// A custom scalar accepts any JSON value: its serialized form is not known here.
	return builtIn ? { type: builtIn } : described(type.description);
}

/**
 * The JSON Schema of a GraphQL input type. Input objects go to `defs` and are
 * referenced, so recursive types work; a nullable type also accepts `null`.
 */
export function typeSchema(type: GraphQLInputType, defs: Defs): JsonSchema {
	return isNonNullType(type)
		? valueSchema(type.ofType, defs)
		: nullable(valueSchema(type, defs));
}
