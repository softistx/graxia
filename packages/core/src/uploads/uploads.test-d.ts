import type { GraphQLScalarType } from 'graphql';
import type { GraphQLFile, UploadsOptions } from '../index';
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
}
