import { createTestClient } from '../testing/client';
import { createGraxia } from './create-graxia';
import { schema } from './fixtures.test-util';

const request = new Request('http://x/graphql');

export async function types() {
	const plain = createGraxia({ schema });
	await plain.fetch(request);
	await plain.execute({ document: '{ hello }' });
	plain.serve();
	createTestClient(plain);

	const hosted = createGraxia<{ db: string }>({ schema });
	await hosted.fetch(request, { db: 'x' });
	await hosted.execute({ document: '{ hello }', serverContext: { db: 'x' } });
	hosted.serve({ serverContext: { db: 'x' }, port: 0 });
	createTestClient(hosted, { serverContext: { db: 'x' } });

	// @ts-expect-error serverContext is required
	await hosted.fetch(request);
	// @ts-expect-error serverContext is required
	await hosted.execute({ document: '{ hello }' });
	// @ts-expect-error serverContext is required
	hosted.serve();
	// @ts-expect-error serverContext is required
	createTestClient(hosted);
	// @ts-expect-error serverContext is required
	createTestClient(hosted, { path: '/x' });
	// @ts-expect-error wrong serverContext shape
	await hosted.fetch(request, { db: 1 });

	const optional = createGraxia<{ db?: string }>({ schema });
	await optional.fetch(request);
	createTestClient(optional);
}
