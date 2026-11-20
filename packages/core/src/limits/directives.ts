import {
	DirectiveLocation,
	type DocumentNode,
	GraphQLBoolean,
	GraphQLDirective,
	GraphQLInt,
	GraphQLList,
	GraphQLNonNull,
	GraphQLString,
	Kind,
	parse,
} from 'graphql';

const COST = {
	directive:
		'The cost of a field, type, enum, scalar, argument or input field in the query cost limit, following the IBM GraphQL cost specification.',
	weight:
		'The cost it adds; it replaces the default object or scalar cost for what it marks.',
} as const;

const LIST_SIZE = {
	directive:
		'How many items a list field returns, used to multiply its cost in the query cost limit, following the IBM GraphQL cost specification.',
	assumedSize:
		'The list size to assume when no slicing argument gives one; it defaults to the server default list size.',
	slicingArguments:
		'The names of the arguments (a dotted path reaches into an input) whose integer value is the list size; the largest given one is used.',
	sizedFields:
		'The fields of the returned object that hold the list (for example the edges of a connection), each sized like this field instead of once.',
	requireOneSlicingArgument:
		'Whether a request must give at least one slicing argument, otherwise it is rejected; true by default.',
} as const;

/** `@cost(weight: Int!)`: what a field, type, enum, scalar, argument or input field costs. */
export const costDirective = new GraphQLDirective({
	name: 'cost',
	description: COST.directive,
	locations: [
		DirectiveLocation.ARGUMENT_DEFINITION,
		DirectiveLocation.ENUM,
		DirectiveLocation.FIELD_DEFINITION,
		DirectiveLocation.INPUT_FIELD_DEFINITION,
		DirectiveLocation.OBJECT,
		DirectiveLocation.SCALAR,
	],
	args: {
		weight: {
			description: COST.weight,
			type: new GraphQLNonNull(GraphQLInt),
		},
	},
});

/** `@listSize(...)`: how many items a list field returns, for the cost. */
export const listSizeDirective = new GraphQLDirective({
	name: 'listSize',
	description: LIST_SIZE.directive,
	locations: [DirectiveLocation.FIELD_DEFINITION],
	args: {
		assumedSize: { description: LIST_SIZE.assumedSize, type: GraphQLInt },
		slicingArguments: {
			description: LIST_SIZE.slicingArguments,
			type: new GraphQLList(new GraphQLNonNull(GraphQLString)),
		},
		sizedFields: {
			description: LIST_SIZE.sizedFields,
			type: new GraphQLList(new GraphQLNonNull(GraphQLString)),
		},
		requireOneSlicingArgument: {
			description: LIST_SIZE.requireOneSlicingArgument,
			type: GraphQLBoolean,
			defaultValue: true,
		},
	},
});

/**
 * The `@cost` and `@listSize` directives, to add to the `directives` of a
 * `GraphQLSchema` you build yourself (`createSchema` adds them for you).
 */
export const costDirectives: readonly GraphQLDirective[] = [
	costDirective,
	listSizeDirective,
];

/** The SDL of both directives, with the same descriptions as the objects above. */
const costSDL = `
"${COST.directive}"
directive @cost(
  "${COST.weight}"
  weight: Int!
) on ARGUMENT_DEFINITION | ENUM | FIELD_DEFINITION | INPUT_FIELD_DEFINITION | OBJECT | SCALAR

"${LIST_SIZE.directive}"
directive @listSize(
  "${LIST_SIZE.assumedSize}"
  assumedSize: Int
  "${LIST_SIZE.slicingArguments}"
  slicingArguments: [String!]
  "${LIST_SIZE.sizedFields}"
  sizedFields: [String!]
  "${LIST_SIZE.requireOneSlicingArgument}"
  requireOneSlicingArgument: Boolean = true
) on FIELD_DEFINITION
`;

const SDL = parse(costSDL);

/** `document` with the `@cost` and `@listSize` definitions it does not declare itself. */
export function withCostDefinitions(document: DocumentNode): DocumentNode {
	const declared = new Set(
		document.definitions.flatMap((definition) =>
			definition.kind === Kind.DIRECTIVE_DEFINITION
				? [definition.name.value]
				: [],
		),
	);
	const missing = SDL.definitions.filter(
		(definition) =>
			definition.kind === Kind.DIRECTIVE_DEFINITION &&
			!declared.has(definition.name.value),
	);
	return missing.length === 0
		? document
		: { ...document, definitions: [...document.definitions, ...missing] };
}
