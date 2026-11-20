import type { GraphQLResolveInfo, GraphQLScalarType } from 'graphql';
import { GraphQLFile, type UploadsOptions } from '../index';
import { createSchema } from '../schema/create-schema';
import { createGraxia } from '../server/create-graxia';
import { schema } from '../server/fixtures.test-util';

type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
		? true
		: false;
const assertType = <_T extends true>() => {};

export function types() {
	createGraxia({ schema, uploads: true });
	createGraxia({ schema, uploads: false });
	createGraxia({
		schema,
		uploads: { fileBytes: 1024, files: 2, bodyBytes: 4096 },
	});
	// @ts-expect-error `maxFileSize` is not an option
	createGraxia({ schema, uploads: { maxFileSize: 1 } });
	// @ts-expect-error a boolean or an object
	createGraxia({ schema, uploads: 'on' });
	assertType<Equal<typeof GraphQLFile, GraphQLScalarType<File, never>>>();
	assertType<Equal<UploadsOptions['files'], number | undefined>>();
	// A resolver types its arguments with a concrete object, no cast.
	createSchema()({
		typeDefs:
			'scalar File type Query { ok: Boolean } type Mutation { upload(file: File!): String! }',
		resolvers: {
			File: GraphQLFile,
			Mutation: { upload: async (_, { file }: { file: File }) => file.name },
		},
	});
	// What graphql-codegen emits with `scalars: { File: 'File' }`.
	interface UploadResolvers {
		Mutation: {
			upload: (
				parent: object,
				args: { file: File },
				ctx: unknown,
				info: GraphQLResolveInfo,
			) => Promise<string>;
		};
	}
	const generated: UploadResolvers = {
		Mutation: { upload: async (_p, { file }) => file.name },
	};
	createSchema()({
		typeDefs:
			'scalar File type Query { ok: Boolean } type Mutation { upload(file: File!): String! }',
		resolvers: { File: GraphQLFile, ...generated },
	});
	// An unannotated resolver gets `args: any` (so a concrete type can be annotated).
	createSchema()({
		typeDefs: 'type Query { ok: Boolean }',
		resolvers: {
			Query: {
				ok: (_, args) => {
					assertType<Equal<typeof args, any>>();
					return args.x.y;
				},
			},
		},
	});
}
