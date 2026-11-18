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
