import {
	type DocumentNode,
	type GraphQLInputType,
	type GraphQLSchema,
	isNonNullType,
	type OperationDefinitionNode,
	typeFromAST,
	valueFromASTUntyped,
} from 'graphql';
import { constrained, tightest } from './constraint';
import { type Defs, typeSchema } from './input-type';
import type { JsonSchema } from './types';
import { variableUsages } from './variable-usage';

/**
 * The JSON Schema (2020-12) of a tool's input: one property per variable of
 * `operation`. A non-null variable without a default is required; a default
 * goes to `default`; the description is the variable's own, else the one of
 * the argument or input field it feeds; `@constraint` comes from input fields
 * and, for a variable, from the arguments it is used at (the tightest when
 * they differ). The document must be valid against `schema`.
 */
export function inputSchemaOf(
	schema: GraphQLSchema,
	document: DocumentNode,
	operation: OperationDefinitionNode,
): JsonSchema {
	const defs: Defs = {};
	const usages = variableUsages(schema, document, operation);
	const properties: Record<string, JsonSchema> = {};
	const required: string[] = [];
	for (const definition of operation.variableDefinitions ?? []) {
		const name = definition.variable.name.value;
		const type = typeFromAST(schema, definition.type) as
			| GraphQLInputType
			| undefined;
		if (!type) continue;
		const usage = usages.get(name);
		const description = definition.description?.value ?? usage?.description;
		properties[name] = {
			...constrained(
				typeSchema(type, defs),
				tightest(usage?.constraints ?? []),
			),
			...(description ? { description } : {}),
			...(definition.defaultValue
				? { default: valueFromASTUntyped(definition.defaultValue) }
				: {}),
		};
		if (isNonNullType(type) && !definition.defaultValue) required.push(name);
	}
	return {
		type: 'object',
		properties,
		...(required.length > 0 ? { required } : {}),
		additionalProperties: false,
		...(Object.keys(defs).length > 0 ? { $defs: defs } : {}),
	};
}
