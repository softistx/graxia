import { assertValidSchema, buildASTSchema } from 'graphql';
import { GraxiaConfigError } from '../errors/config-error';
import { attachResolvers } from './attach';
import { withIncrementalDirectives } from './directives';
import { mergeResolvers } from './merge';
import { sdlError, toDocument } from './typedefs';
import type { Resolvers, SchemaOptions, SchemaWithContext } from './types';

/**
 * Builds a `GraphQLSchema` from SDL and typed resolvers. Curried so `Ctx` is
 * explicit while `resolvers` infers; pass a second generic to type the
 * resolvers as graphql-codegen's `Resolvers` instead of the built-in loose one.
 * Returns a plain `GraphQLSchema`; any `GraphQLSchema` works wherever one is
 * expected, this is only a helper.
 *
 * @example
 * const schema = createSchema<AppContext>()({
 *   typeDefs: "type Query { me: String }",
 *   resolvers: { Query: { me: (_, __, ctx) => ctx.user.name } },
 * });
 * @throws {GraxiaConfigError} on invalid SDL, an invalid schema, a duplicate
 * resolver, or a resolver for a type or field the schema lacks.
 */
export function createSchema<Ctx = unknown, R = Resolvers<Ctx>>() {
	return (options: SchemaOptions<R>): SchemaWithContext<Ctx> => {
		const document = toDocument(options.typeDefs);
		let schema: SchemaWithContext<Ctx>;
		try {
			const built = buildASTSchema(document);
			schema =
				options.incremental === false
					? built
					: withIncrementalDirectives(built);
		} catch (cause) {
			throw sdlError(cause);
		}
		try {
			assertValidSchema(schema);
		} catch (cause) {
			const message = cause instanceof Error ? cause.message : String(cause);
			throw new GraxiaConfigError(`Invalid schema: ${message}`, { cause });
		}
		const given = options.resolvers;
		const maps = (
			Array.isArray(given) ? given : given ? [given] : []
		) as readonly Record<string, unknown>[];
		attachResolvers(schema, mergeResolvers(maps));
		return schema;
	};
}
