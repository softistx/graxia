import { createGraxia } from './create-graxia';
import { schema } from './fixtures.test-util';

type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
		? true
		: false;
const assertType = <_T extends true>() => {};

export async function types() {
	const graxia = createGraxia({ schema });
	await graxia.execute({ document: '{ hello }' });
	assertType<Equal<typeof graxia.schema, import('graphql').GraphQLSchema>>();
	assertType<
		Equal<
			typeof graxia.limits,
			{ readonly bodyBytes: number; readonly tokens: number | false }
		>
	>();
	assertType<
		Equal<
			typeof graxia.trustedDocuments,
			{ readonly mode: 'strict' | 'mixed' } | undefined
		>
	>();
	// A manifest imported from JSON: `format` is a string and `version` a number there.
	const imported: {
		format: string;
		version: number;
		operations: { id: string; body: string; name: string; type: string }[];
	} = {
		format: 'apollo-persisted-query-manifest',
		version: 1,
		operations: [],
	};
	createGraxia({ schema, trustedDocuments: { manifest: imported } });
	createGraxia({
		schema,
		// @ts-expect-error operations hold { id, body }
		trustedDocuments: { manifest: { ...imported, operations: [{ id: 1 }] } },
	});
	await graxia.execute({ documentId: 'abc', variables: { a: 1 } });

	// @ts-expect-error a document and a documentId are exclusive
	await graxia.execute({ document: '{ hello }', documentId: 'abc' });
	// @ts-expect-error one of document or documentId is required
	await graxia.execute({});

	const typed = await graxia.execute<{ hello: string }, { a: number }>({
		documentId: 'abc',
		variables: { a: 1 },
	});
	assertType<Equal<typeof typed.data, { hello: string } | null | undefined>>();
	await graxia.execute<{ hello: string }, { a: number }>({
		documentId: 'abc',
		// @ts-expect-error the variables follow the Variables type
		variables: { a: 'x' },
	});
}
