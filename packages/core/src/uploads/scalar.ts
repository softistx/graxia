import { GraphQLError, GraphQLScalarType } from 'graphql';

const MESSAGE =
	'File must be sent as a file part of a multipart request (GraphQL multipart request spec).';

const refuse = (): never => {
	throw new GraphQLError(MESSAGE, { extensions: { code: 'BAD_USER_INPUT' } });
};

/**
 * The `File` scalar of the GraphQL multipart request spec, input only: the
 * resolver receives Bun's Web `File`. Anything that is not a `File` (a string
 * in a JSON request, an inline literal) is refused.
 *
 * @example
 * createSchema()({ typeDefs: 'scalar File ...', resolvers: { File: GraphQLFile } });
 */
export const GraphQLFile: GraphQLScalarType<File, never> =
	new GraphQLScalarType<File, never>({
		name: 'File',
		description: 'A file sent as a part of a multipart request.',
		serialize: refuse,
		parseValue: (value: unknown): File =>
			value instanceof File ? value : (refuse() as never),
		parseLiteral: refuse,
	});
