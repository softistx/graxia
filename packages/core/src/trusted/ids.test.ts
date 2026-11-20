import { describe, expect, test } from 'bun:test';
import { codes, HELLO, hash, setup } from './trusted.test-util';

describe('documentId', () => {
	const manifest = { 'doc-1': HELLO };

	test('runs a manifest document over POST and GET', async () => {
		const { client } = setup({ manifest, mode: 'mixed' });
		const post = await client.query(null, { documentId: 'doc-1' });
		expect(post.data).toEqual({ hello: 'world' });
		const get = await client.query(null, {
			documentId: 'doc-1',
			method: 'GET',
		});
		expect(get.data).toEqual({ hello: 'world' });
	});

	test('runs over server-sent events and execute', async () => {
		const { graxia } = setup({ manifest, mode: 'strict' });
		const response = await graxia.fetch(
			new Request('http://graxia.local/graphql', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					accept: 'text/event-stream',
				},
				body: JSON.stringify({ documentId: 'doc-1' }),
			}),
		);
		expect(await response.text()).toContain('"hello":"world"');
		const result = await graxia.execute({ documentId: 'doc-1' });
		expect(result.data).toEqual({ hello: 'world' });
	});

	test('an unknown id is refused', async () => {
		const { client } = setup({ manifest });
		const result = await client.query(null, { documentId: 'nope' });
		expect(result.status).toBe(400);
		expect(result.errors?.[0]?.message).toBe(
			'Persisted document nope not found.',
		);
		expect(codes(result.errors)).toEqual(['PERSISTED_QUERY_NOT_FOUND']);
	});

	test('a query beside the id is refused', async () => {
		const { client } = setup({ manifest });
		const result = await client.query(HELLO, { documentId: 'doc-1' });
		expect(result.status).toBe(400);
		expect(result.errors?.[0]?.message).toBe(
			'Send either documentId or query, not both.',
		);
	});

	test('a documentId that is not a string is a 400', async () => {
		const { graxia } = setup({ manifest });
		const response = await graxia.fetch(
			new Request('http://graxia.local/graphql', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ documentId: 3 }),
			}),
		);
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			errors: [
				{
					message: 'The "documentId" parameter must be a string.',
					extensions: { code: 'PARAMS_INVALID', fix: expect.any(String) },
				},
			],
		});
	});

	test('a sha256 documentId finds the manifest entry by its hex', async () => {
		const { client } = setup({ manifest: { [hash]: HELLO } });
		const result = await client.query(null, {
			documentId: `sha256:${hash}`,
		});
		expect(result.data).toEqual({ hello: 'world' });
	});

	test('a mutation by id over GET stays 405', async () => {
		const { client } = setup({ manifest: { m: 'mutation { bump }' } });
		const result = await client.query(null, { documentId: 'm', method: 'GET' });
		expect(result.status).toBe(405);
	});

	test('manifest formats all serve documents', async () => {
		for (const m of [
			new Map([['a', HELLO]]),
			{
				format: 'apollo-persisted-query-manifest' as const,
				version: 1 as const,
				operations: [{ id: 'a', body: HELLO, name: 'H', type: 'query' }],
			},
		]) {
			const { client } = setup({ manifest: m });
			expect((await client.query(null, { documentId: 'a' })).data).toEqual({
				hello: 'world',
			});
		}
	});
});

describe('extractKey', () => {
	test('takes the id from the request, first', async () => {
		const { client } = setup({
			manifest: { fromHeader: HELLO },
			extractKey: (_params, request) =>
				request?.headers.get('x-document') ?? undefined,
		});
		const result = await client.query(null, {
			documentId: 'ignored',
			headers: { 'x-document': 'fromHeader' },
		});
		expect(result.data).toEqual({ hello: 'world' });
	});
});
