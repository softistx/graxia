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

/** `@cost(weight: Int!)`: what a field, type, enum, scalar, argument or input field costs. */
export const costDirective = new GraphQLDirective({
	name: 'cost',
	locations: [
		DirectiveLocation.ARGUMENT_DEFINITION,
		DirectiveLocation.ENUM,
		DirectiveLocation.FIELD_DEFINITION,
		DirectiveLocation.INPUT_FIELD_DEFINITION,
		DirectiveLocation.OBJECT,
		DirectiveLocation.SCALAR,
	],
	args: { weight: { type: new GraphQLNonNull(GraphQLInt) } },
});

/** `@listSize(...)`: how many items a list field returns, for the cost. */
export const listSizeDirective = new GraphQLDirective({
	name: 'listSize',
	locations: [DirectiveLocation.FIELD_DEFINITION],
	args: {
		assumedSize: { type: GraphQLInt },
		slicingArguments: {
			type: new GraphQLList(new GraphQLNonNull(GraphQLString)),
		},
		sizedFields: { type: new GraphQLList(new GraphQLNonNull(GraphQLString)) },
		requireOneSlicingArgument: {
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

const SDL = parse(`
directive @cost(weight: Int!) on ARGUMENT_DEFINITION | ENUM | FIELD_DEFINITION | INPUT_FIELD_DEFINITION | OBJECT | SCALAR
directive @listSize(assumedSize: Int, slicingArguments: [String!], sizedFields: [String!], requireOneSlicingArgument: Boolean = true) on FIELD_DEFINITION
`);

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
