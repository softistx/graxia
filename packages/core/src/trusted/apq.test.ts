import { describe, expect, test } from 'bun:test';
import { createMemoryCache } from '../cache/memory';
import type { KeyValueCache } from '../cache/types';
import { definePlugin } from '../plugins/define';
import { createGraxia } from '../server/create-graxia';
import { schema } from '../server/fixtures.test-util';
import { createTestClient } from '../testing/client';
import { sha256Hex, storeKey } from './apq';
import { codes, HELLO, hash, setup } from './trusted.test-util';

describe('automatic persisted queries', () => {
	test('a document over the cost limit is refused and not stored', async () => {
		const store = createMemoryCache<string>();
		const graxia = createGraxia({
			schema,
			onUnexpected: false,
			limits: { cost: { max: 1, scalarCost: 5 } },
			trustedDocuments: { mode: 'mixed', store },
		});
		const result = await createTestClient(graxia).query(HELLO, {
			persisted: true,
		});
		expect(result.data).toBeUndefined();
		expect(result.errors).toBeDefined();
		await Promise.resolve();
		expect(await store.get(storeKey(hash))).toBeUndefined();
		await graxia.dispose({ timeout: 10 });
	});

	test('not found, then registered, then a hit (POST and GET)', async () => {
		const { client } = setup({ mode: 'mixed' });
		const miss = await client.query(null, { persisted: { sha256Hash: hash } });
		expect(miss.errors?.[0]?.message).toBe('PersistedQueryNotFound');
		expect(codes(miss.errors)).toEqual(['PERSISTED_QUERY_NOT_FOUND']);
		const register = await client.query(HELLO, { persisted: true });
		expect(register.data).toEqual({ hello: 'world' });
		const post = await client.query(null, { persisted: { sha256Hash: hash } });
		expect(post.data).toEqual({ hello: 'world' });
		const get = await client.query(null, {
			persisted: { sha256Hash: hash },
			method: 'GET',
		});
		expect(get.data).toEqual({ hello: 'world' });
	});

	test('a media type that carries 200 keeps it for the retry protocol', async () => {
		const { client } = setup({ mode: 'mixed' });
		const json = await client.query(null, {
			persisted: { sha256Hash: hash },
			accept: 'application/json',
		});
		expect(json.status).toBe(200);
		const modern = await client.query(null, {
			persisted: { sha256Hash: hash },
		});
		expect(modern.status).toBe(400);
	});

	test('a hash that does not match the query is refused and not stored', async () => {
		const store = createMemoryCache<string>();
		const { client } = setup({ store });
		const result = await client.query(HELLO, {
			persisted: { sha256Hash: sha256Hex('{ other }') },
		});
		expect(result.errors?.[0]?.message).toBe(
			'provided sha does not match query',
		);
		expect(codes(result.errors)).toEqual(['PROVIDED_SHA_DOESNT_MATCH']);
		expect(await store.get(`pq:${sha256Hex('{ other }')}`)).toBeUndefined();
	});

	test('a version other than 1 is refused', async () => {
		const { graxia } = setup({});
		const response = await graxia.fetch(
			new Request('http://graxia.local/graphql', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					extensions: { persistedQuery: { version: 2, sha256Hash: hash } },
				}),
			}),
		);
		const body = (await response.json()) as { errors: any[] };
		expect(body.errors[0].message).toBe('Unsupported persisted query version');
		expect(body.errors[0].extensions.code).toBe(
			'PERSISTED_QUERY_VERSION_NOT_SUPPORTED',
		);
	});

	test('an invalid document is never stored', async () => {
		const store = createMemoryCache<string>();
		const { client } = setup({ store });
		for (const text of ['{ nope }', '{ hello']) {
			const result = await client.query(text, { persisted: true });
			expect(result.errors).toBeDefined();
			expect(await store.get(`pq:${sha256Hex(text)}`)).toBeUndefined();
		}
	});

	test('apq off answers PersistedQueryNotSupported', async () => {
		const { client } = setup({ apq: false });
		const result = await client.query(HELLO, { persisted: true });
		expect(result.errors?.[0]?.message).toBe('PersistedQueryNotSupported');
		expect(codes(result.errors)).toEqual(['PERSISTED_QUERY_NOT_SUPPORTED']);
	});

	test('a failing store.get is reported and answers not found', async () => {
		const reported: unknown[] = [];
		const store: KeyValueCache<string> = {
			get: () => Promise.reject(new Error('redis down')),
			set: () => Promise.resolve(),
			delete: () => Promise.resolve(false),
		};
		const { client } = setup({ store }, { reported });
		const result = await client.query(null, {
			persisted: { sha256Hash: hash },
		});
		expect(codes(result.errors)).toEqual(['PERSISTED_QUERY_NOT_FOUND']);
		expect(reported).toHaveLength(1);
	});

	test('a failing store.set is reported and the operation still runs', async () => {
		const reported: unknown[] = [];
		const store: KeyValueCache<string> = {
			get: () => Promise.resolve(undefined),
			set: () => Promise.reject(new Error('redis down')),
			delete: () => Promise.resolve(false),
		};
		const { client } = setup({ store }, { reported });
		const result = await client.query(HELLO, { persisted: true });
		expect(result.data).toEqual({ hello: 'world' });
		await Bun.sleep(5); // the registration runs in the background
		expect(reported).toHaveLength(1);
	});

	test('a registration never blocks the request', async () => {
		const store: KeyValueCache<string> = {
			get: () => Promise.resolve(undefined),
			set: () => new Promise(() => {}),
			delete: () => Promise.resolve(false),
		};
		const { client } = setup({ store });
		const result = await client.query(HELLO, { persisted: true });
		expect(result.data).toEqual({ hello: 'world' });
	});

	test('a query an onParams plugin rewrote is not registered', async () => {
		const store = createMemoryCache<string>();
		const graxia = createGraxia({
			schema,
			trustedDocuments: { store },
			plugins: [
				definePlugin({
					name: 'rewrite',
					onParams: ({ params, setParams }) =>
						setParams({ ...params, query: '{ who: hello }' }),
				}),
			],
		});
		const result = await createTestClient(graxia).query(HELLO, {
			persisted: true,
		});
		expect(result.data).toEqual({ who: 'world' });
		await Bun.sleep(5);
		expect(await store.get(`pq:${hash}`)).toBeUndefined();
	});
});
