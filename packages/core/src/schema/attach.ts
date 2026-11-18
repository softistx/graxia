import {
	type GraphQLEnumType,
	type GraphQLInterfaceType,
	type GraphQLNamedType,
	type GraphQLObjectType,
	GraphQLScalarType,
	type GraphQLSchema,
	type GraphQLUnionType,
	isEnumType,
	isInterfaceType,
	isObjectType,
	isScalarType,
	isUnionType,
} from 'graphql';
import { GraxiaConfigError } from '../errors/config-error';

type Loose = Record<string, unknown>;

const fail = (message: string): never => {
	throw new GraxiaConfigError(message);
};

/**
 * Attaches a merged resolver map to a freshly built (unshared) schema by
 * mutating its type and field objects, so every reference stays consistent.
 */
export function attachResolvers(schema: GraphQLSchema, resolvers: Loose): void {
	for (const [name, value] of Object.entries(resolvers)) {
		const type = schema.getType(name);
		if (!type) {
			fail(
				`Resolvers for ${name} are defined but the schema has no type ${name}`,
			);
			continue;
		}
		attachType(type, value);
	}
}

function attachType(type: GraphQLNamedType, value: unknown): void {
	if (isScalarType(type)) {
		attachScalar(type, value);
		return;
	}
	if (value instanceof GraphQLScalarType) {
		fail(
			`Resolvers for ${type.name} is a GraphQLScalarType but ${type.name} is not a scalar`,
		);
	}
	if (typeof value !== 'object' || value === null) {
		fail(`Resolvers for ${type.name} must be an object`);
	}
	const map = value as Loose;
	if (isEnumType(type)) {
		attachEnum(type, map);
		return;
	}
	if (isObjectType(type) || isInterfaceType(type)) {
		attachFields(type, map);
		return;
	}
	if (isUnionType(type)) {
		attachUnion(type, map);
		return;
	}
	fail(
		`Resolvers for ${type.name} are defined but ${type.name} is an input type`,
	);
}

function attachScalar(type: GraphQLScalarType, value: unknown): void {
	if (!(value instanceof GraphQLScalarType)) {
		fail(`Resolvers for scalar ${type.name} must be a GraphQLScalarType`);
		return;
	}
	const rest = value.toConfig();
	Object.assign(type, {
		...rest,
		astNode: type.astNode,
		extensionASTNodes: type.extensionASTNodes,
		extensions: type.extensions,
		description: type.description ?? rest.description,
	});
}

function attachEnum(type: GraphQLEnumType, map: Loose): void {
	for (const [valueName, internal] of Object.entries(map)) {
		const enumValue = type.getValue(valueName);
		if (!enumValue) {
			fail(
				`Resolver ${type.name}.${valueName} is defined but enum ${type.name} has no value ${valueName}`,
			);
			continue;
		}
		(enumValue as { value: unknown }).value = internal;
	}
}

function attachUnion(type: GraphQLUnionType, map: Loose): void {
	for (const [key, entry] of Object.entries(map)) {
		if (key !== '__resolveType') {
			fail(
				`Resolver ${type.name}.${key} is defined but a union has no fields; only __resolveType is allowed`,
			);
		}
		type.resolveType = entry as GraphQLUnionType['resolveType'];
	}
}

function attachFields(
	type: GraphQLObjectType | GraphQLInterfaceType,
	map: Loose,
): void {
	const fields = type.getFields();
	for (const [key, entry] of Object.entries(map)) {
		if (entry === undefined) continue;
		if (key === '__resolveType' && isInterfaceType(type)) {
			type.resolveType = entry as GraphQLInterfaceType['resolveType'];
		} else if (key === '__isTypeOf' && isObjectType(type)) {
			type.isTypeOf = entry as GraphQLObjectType['isTypeOf'];
		} else if (key.startsWith('__')) {
			fail(
				`Resolver ${type.name}.${key} is not valid on ${isObjectType(type) ? 'an object' : 'an interface'} type`,
			);
		} else {
			const field = fields[key];
			if (!field) {
				fail(
					`Resolver ${type.name}.${key} is defined but ${type.name} has no field ${key}`,
				);
				continue;
			}
			attachField(field, type.name, key, entry);
		}
	}
}

function attachField(
	field: { resolve?: unknown; subscribe?: unknown },
	typeName: string,
	key: string,
	entry: unknown,
): void {
	if (typeof entry === 'function') {
		field.resolve = entry;
	} else if (typeof entry === 'object' && entry !== null) {
		const { resolve, subscribe } = entry as Loose;
		if (resolve !== undefined) field.resolve = resolve;
		if (subscribe !== undefined) field.subscribe = subscribe;
	} else {
		fail(
			`Resolver ${typeName}.${key} must be a function or { resolve, subscribe }`,
		);
	}
}
