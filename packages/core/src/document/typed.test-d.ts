import { parse, type TypedQueryDocumentNode } from 'graphql';
import { createGraxia } from '../server/create-graxia';
import { schema } from '../server/fixtures.test-util';
import { createTestClient } from '../testing/client';
import type { TypedDocument, TypedString } from './typed';

type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
		? true
		: false;
const assertType = <_T extends true>() => {};

const graxia = createGraxia({ schema });
const client = createTestClient(graxia);
const node = parse('{ hello }');
const typed = node as TypedDocument<{ hello: string }, { id: string }>;
const text = '{ hello }' as TypedString<{ hello: string }, { id: string }>;
const graphqlTyped = node as TypedQueryDocumentNode<
	{ hello: string },
	{ id: string }
>;

export async function types() {
	for (const document of [typed, text, graphqlTyped]) {
		const result = await graxia.execute({ document, variables: { id: '1' } });
		assertType<
			Equal<typeof result.data, { hello: string } | null | undefined>
		>();
		// @ts-expect-error variables do not match the document
		await graxia.execute({ document, variables: { id: 1 } });
		// @ts-expect-error unknown variable
		await graxia.execute({ document, variables: { other: '1' } });
		const viaClient = await client.query(document, { variables: { id: '1' } });
		assertType<
			Equal<typeof viaClient.data, { hello: string } | null | undefined>
		>();
		// @ts-expect-error variables do not match the document
		await client.query(document, { variables: { id: 1 } });
		// @ts-expect-error mutate has no GET
		await client.mutate(document, { method: 'GET' });
	}
	// Untyped documents stay open.
	await graxia.execute({ document: '{ hello }', variables: { any: 1 } });
	await graxia.execute({ document: node });
}
