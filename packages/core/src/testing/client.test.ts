import { describe, expect, test } from 'bun:test';
import { parse } from 'graphql';
import { definePlugin } from '../plugins/define';
import { createGraxia } from '../server/create-graxia';
import { schema } from '../server/fixtures.test-util';
import { sha256Hex } from './document';
import { createTestClient, expectNoErrors } from './index';

const quiet = { onUnexpected: false } as const;
const sha = (text: string) =>
	new Bun.CryptoHasher('sha256').update(text).digest('hex');

describe('createTestClient', () => {
	test('POST and GET queries', async () => {
		const client = createTestClient(createGraxia({ schema, ...quiet }));
		const post = await client.query<{ hello: string }>('{ hello }');
		expect(post.status).toBe(200);
		expect(post.data?.hello).toBe('world');
		expect(post.headers.get('content-type')).toContain(
			'application/graphql-response+json',
		);
		expect(post.body).toEqual({ data: { hello: 'world' } });
		const get = await client.query('{ hello }', { method: 'GET' });
		expect(get.status).toBe(200);
		expect(get.data).toEqual({ hello: 'world' });
	});

	test('DocumentNode, variables and operationName over GET and POST', async () => {
		const client = createTestClient(createGraxia({ schema, ...quiet }));
		for (const method of ['GET', 'POST'] as const) {
			const result = await client.query(
				parse('query A { hello } query B { hello }'),
				{ method, operationName: 'B', variables: { unused: 1 } },
			);
			expect(result.data).toEqual({ hello: 'world' });
		}
	});

	test('statuses: 400 parse error, 405 mutation over GET, 406 accept', async () => {
		const client = createTestClient(createGraxia({ schema, ...quiet }));
		const parseError = await client.query('{ hello');
		expect(parseError.status).toBe(400);
		expect(parseError.errors?.[0]?.message).toContain('Syntax Error');
		const mutation = await client.query('mutation { bump }', { method: 'GET' });
		expect(mutation.status).toBe(405);
		expect(mutation.headers.get('allow')).toBe('POST');
		expect((await client.mutate('mutation { bump }')).data).toEqual({
			bump: 1,
		});
		const refused = await client.query('{ hello }', { accept: 'text/html' });
		expect(refused.status).toBe(406);
	});

	test('accept override picks the media type', async () => {
		const client = createTestClient(createGraxia({ schema, ...quiet }));
		const legacy = await client.query('{ hello', {
			accept: 'application/json',
		});
		expect(legacy.status).toBe(200);
		expect(legacy.headers.get('content-type')).toContain('application/json');
	});

	test('headers merge: client, then request; path and serverContext', async () => {
		const seen: Headers[] = [];
		const graxia = createGraxia<{ role: string }>({
			schema,
			...quiet,
			path: '/api',
			plugins: [
				definePlugin({
					name: 'spy',
					onRequest: ({ request }) => {
						seen.push(request.headers);
					},
				}),
			],
		});
		const client = createTestClient(graxia, {
			path: '/api',
			headers: { 'x-a': '1', 'x-b': 'client' },
			serverContext: { role: 'admin' },
		});
		await client.query('{ hello }', { headers: { 'x-b': 'request' } });
		expect(seen[0]?.get('x-a')).toBe('1');
		expect(seen[0]?.get('x-b')).toBe('request');
		expect((await client.query('{ hello }')).status).toBe(200);
	});

	test('persisted: true sends the APQ extension with the computed hash', async () => {
		const bodies: any[] = [];
		const urls: string[] = [];
		const graxia = createGraxia({
			schema,
			...quiet,
			plugins: [
				definePlugin({
					name: 'spy',
					onParams: ({ params, request }: any) => {
						bodies.push(params);
						urls.push(request.url);
					},
				}),
			],
		});
		const client = createTestClient(graxia);
		const hash = sha('{ hello }');
		expect(sha256Hex('{ hello }')).toBe(hash);
		const result = await client.query('{ hello }', { persisted: true });
		expect(result.data).toEqual({ hello: 'world' });
		expect(bodies[0].extensions).toEqual({
			persistedQuery: { version: 1, sha256Hash: hash },
		});
		await client.query('{ hello }', { persisted: true, method: 'GET' });
		expect(
			JSON.parse(new URL(urls[1] ?? '').searchParams.get('extensions') ?? ''),
		).toEqual({
			persistedQuery: { version: 1, sha256Hash: hash },
		});
		// A hash alone: no query text; today's server has no persisted store.
		const alone = await client.query(null, { persisted: { sha256Hash: hash } });
		expect(bodies[2].query).toBeUndefined();
		expect(alone.status).toBe(400);
		expect(alone.errors?.[0]?.message).toBe('Must provide a query string.');
		expect(client.query(null)).rejects.toThrow('persisted');
	});

	test('batch', async () => {
		const graxia = createGraxia({ schema, ...quiet, batching: { limit: 5 } });
		const client = createTestClient(graxia);
		const batch = await client.batch([
			{ document: '{ hello }' },
			{ document: 'query Q { hello }', operationName: 'Q' },
		]);
		expect(batch.status).toBe(200);
		expect(batch.results.map((r) => r.data)).toEqual([
			{ hello: 'world' },
			{ hello: 'world' },
		]);
		const off = await createTestClient(
			createGraxia({ schema, ...quiet }),
		).batch([{ document: '{ hello }' }]);
		expect(off.status).toBe(400);
		expect(off.results).toEqual([]);
	});
});

describe('expectNoErrors', () => {
	test('passes without errors and lists them otherwise', async () => {
		const client = createTestClient(createGraxia({ schema, ...quiet }));
		expectNoErrors(await client.query('{ hello }'));
		expect(() =>
			expectNoErrors({ errors: [{ message: 'x', path: ['a', 0] }] }),
		).toThrow('- x at a.0');
		const bad = await client.query('{ nope }');
		expect(() => expectNoErrors(bad)).toThrow('nope');
	});
});
