import {
	DirectiveLocation,
	GraphQLDirective,
	GraphQLFloat,
	GraphQLInt,
	GraphQLList,
	GraphQLNonNull,
	type GraphQLScalarType,
	GraphQLString,
} from 'graphql';

/** The SDL of each agent directive, by name. */
export const directiveSDL = {
	needs: `"The permission a caller needs to see and use this field or type: one permission, or any of a list. Give exactly one of the two arguments; repeat the directive to require several (AND)."
directive @needs(permission: String, anyOf: [String!]) repeatable on FIELD_DEFINITION | OBJECT | INTERFACE`,
	constraint: `"Limits of an input value, for clients and agents. Not enforced by graxia."
directive @constraint(minLength: Int, maxLength: Int, min: Float, max: Float, exclusiveMin: Float, exclusiveMax: Float, multipleOf: Float, minItems: Int, maxItems: Int, pattern: String, format: String) on ARGUMENT_DEFINITION | INPUT_FIELD_DEFINITION`,
	errors: `"The error codes (extensions.code) this field may return."
directive @errors(codes: [String!]!) on FIELD_DEFINITION`,
} as const;

/** The name of an agent directive. */
export type AgentDirectiveName = keyof typeof directiveSDL;

/**
 * The SDL of `@needs`, `@constraint` and `@errors`. Put it first in
 * `createSchema({ typeDefs: [agentTypeDefs, ...] })` to use them.
 */
export const agentTypeDefs: string = Object.values(directiveSDL).join('\n\n');

const optional = (type: GraphQLScalarType) => ({ type });

/**
 * The same three directives as `GraphQLDirective` objects, for a schema built
 * in code: `new GraphQLSchema({ directives: [...specifiedDirectives, ...agentDirectives] })`.
 */
export const agentDirectives: readonly GraphQLDirective[] = [
	new GraphQLDirective({
		name: 'needs',
		description:
			'The permission a caller needs to see and use this field or type: one permission, or any of a list. Give exactly one of the two arguments; repeat the directive to require several (AND).',
		locations: [
			DirectiveLocation.FIELD_DEFINITION,
			DirectiveLocation.OBJECT,
			DirectiveLocation.INTERFACE,
		],
		isRepeatable: true,
		args: {
			permission: optional(GraphQLString),
			anyOf: { type: new GraphQLList(new GraphQLNonNull(GraphQLString)) },
		},
	}),
	new GraphQLDirective({
		name: 'constraint',
		description:
			'Limits of an input value, for clients and agents. Not enforced by graxia.',
		locations: [
			DirectiveLocation.ARGUMENT_DEFINITION,
			DirectiveLocation.INPUT_FIELD_DEFINITION,
		],
		args: {
			minLength: optional(GraphQLInt),
			maxLength: optional(GraphQLInt),
			min: optional(GraphQLFloat),
			max: optional(GraphQLFloat),
			exclusiveMin: optional(GraphQLFloat),
			exclusiveMax: optional(GraphQLFloat),
			multipleOf: optional(GraphQLFloat),
			minItems: optional(GraphQLInt),
			maxItems: optional(GraphQLInt),
			pattern: optional(GraphQLString),
			format: optional(GraphQLString),
		},
	}),
	new GraphQLDirective({
		name: 'errors',
		description: 'The error codes (extensions.code) this field may return.',
		locations: [DirectiveLocation.FIELD_DEFINITION],
		args: {
			codes: {
				type: new GraphQLNonNull(
					new GraphQLList(new GraphQLNonNull(GraphQLString)),
				),
			},
		},
	}),
];
