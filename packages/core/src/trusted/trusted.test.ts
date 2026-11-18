import { describe, expect, test } from 'bun:test';
import { createMemoryCache } from '../cache/memory';
import { createGraxia } from '../server/create-graxia';
import { schema } from '../server/fixtures.test-util';
import { createTestClient } from '../testing/client';
import { codes, HELLO, hash, setup } from './trusted.test-util';

describe('strict and mixed', () => {
	const manifest = { 'doc-1': HELLO };

	test('strict refuses an arbitrary query and accepts a manifest id', async () => {
		const { client } = setup({ manifest, mode: 'strict' });
		const refused = await client.query('{ hello }');
		expect(refused.status).toBe(400);
		expect(refused.errors?.[0]?.message).toBe(
			'Only persisted documents are allowed.',
		);
		expect(codes(refused.errors)).toEqual(['PERSISTED_QUERY_ONLY']);
		expect(JSON.stringify(refused.errors?.[0]?.extensions)).toContain('mixed');
		expect((await client.query(null, { documentId: 'doc-1' })).data).toEqual({
			hello: 'world',
		});
	});

	test('strict refuses APQ registration, and serves a hash from the manifest', async () => {
		const { client } = setup({ manifest: { [hash]: HELLO }, mode: 'strict' });
		const other = '{ who }';
		const refused = await client.query(other, { persisted: true });
		expect(codes(refused.errors)).toEqual(['PERSISTED_QUERY_NOT_SUPPORTED']);
		const hit = await client.query(HELLO, { persisted: true });
		expect(hit.data).toEqual({ hello: 'world' });
	});

	test('strict with extractKey and a store runs what the store holds', async () => {
		const store = createMemoryCache<string>();
		await store.set('pq:stored', HELLO);
		const { client } = setup({
			mode: 'strict',
			store,
			extractKey: (_p, request) => request?.headers.get('x-doc') ?? undefined,
		});
		const result = await client.query(null, {
			documentId: 'unused',
			headers: { 'x-doc': 'stored' },
		});
		expect(result.data).toEqual({ hello: 'world' });
	});

	test('mixed runs arbitrary queries', async () => {
		const { client } = setup({ manifest, mode: 'mixed' });
		expect((await client.query(HELLO)).data).toEqual({ hello: 'world' });
	});

	test('without the option nothing changes: no ids, no APQ', async () => {
		const graxia = createGraxia({ schema });
		const client = createTestClient(graxia);
		expect((await client.query(HELLO)).data).toEqual({ hello: 'world' });
		const withId = await client.query(null, { documentId: 'x' });
		expect(withId.errors?.[0]?.message).toBe('Must provide a query string.');
		const apq = await client.query(HELLO, { persisted: true });
		expect(apq.data).toEqual({ hello: 'world' });
	});
});

describe('batches', () => {
	test('each entry is resolved on its own', async () => {
		const { client } = setup({ manifest: { a: HELLO }, mode: 'mixed' });
		const { results } = await client.batch([
			{ document: null, documentId: 'a' },
			{ document: '{ hello }' },
			{ document: null, documentId: 'missing' },
		]);
		expect(results[0]?.data).toEqual({ hello: 'world' });
		expect(results[1]?.data).toEqual({ hello: 'world' });
		expect(codes(results[2]?.errors)).toEqual(['PERSISTED_QUERY_NOT_FOUND']);
	});
});
