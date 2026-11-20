import { agentTypeDefs } from '@softistx/graxia/agent';
import {
	buildSchema,
	type DocumentNode,
	Kind,
	type OperationDefinitionNode,
	parse,
} from 'graphql';

/** A schema that exercises every input and output shape. */
export const schema = buildSchema(/* GraphQL */ `
	${agentTypeDefs}
	"""An ISO date."""
	scalar Date
	"""How to sort."""
	enum Sort {
		"""Newest first."""
		NEW
		OLD
	}
	"""A filter."""
	input Filter {
		"""Words to find."""
		text: String @constraint(minLength: 2, maxLength: 50)
		tags: [String!] @constraint(maxItems: 3, pattern: "^[a-z]+$")
		sort: Sort = NEW
		limit: Int! = 10
		after: Date
		and: [Filter!]
		pick: Pick
		old: Boolean @deprecated(reason: "unused")
	}
	input Pick @oneOf {
		"""By id."""
		id: ID
		slug: String @constraint(format: "slug")
	}
	interface Node {
		id: ID!
	}
	type Book implements Node {
		id: ID!
		title: String!
		note: String
		pages: Int
		rating: Float
		sort: Sort
		published: Date
		tags: [String!]!
		related: [Book]
	}
	type Author implements Node {
		id: ID!
		name: String!
	}
	union Hit = Book | Author
	type Query {
		book(
			"""The id of the book."""
			id: ID! @constraint(minLength: 1, maxLength: 36)
		): Book
		byTitle(title: String @constraint(maxLength: 20, pattern: "^a")): Book
		byPrefix(title: String @constraint(maxLength: 10, pattern: "^b")): Book
		books(filter: Filter, first: Int = 5, flag: Boolean, ratio: Float, on: Date): [Book!]!
		node(id: ID!): Node
		search(text: String!): [Hit!]!
		pick(pick: Pick!): Book
	}
	type Mutation {
		rename(id: ID!, title: String!): Book
	}
`);

/** The parsed document of `source` and its first operation. */
export function operationOf(source: string): {
	document: DocumentNode;
	operation: OperationDefinitionNode;
} {
	const document = parse(source);
	const operation = document.definitions.find(
		(d): d is OperationDefinitionNode => d.kind === Kind.OPERATION_DEFINITION,
	);
	if (!operation) throw new Error('no operation');
	return { document, operation };
}
