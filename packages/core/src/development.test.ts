import { describe, expect, spyOn, test } from 'bun:test';
import {
	type Body,
	build,
	byId,
	codes,
	post,
} from './profile/profile.test-util';

// NODE_ENV unset: the same instance as production.test.ts, with the development defaults.
const graxia = build(undefined);

describe('development profile (NODE_ENV unset) differs from production', () => {
	test('introspection answers', async () => {
		const { response, body } = await byId(graxia, 'schema');
		expect(response.status).toBe(200);
		expect(body.data).toEqual({ __schema: { queryType: { name: 'Query' } } });
	});

	test('"Did you mean" suggestions are kept', async () => {
		const { body } = await byId(graxia, 'typo');
		expect(JSON.stringify(body)).toContain('Did you mean');
	});

	test('trusted documents are mixed: a query in full runs', async () => {
		const response = await post(graxia, { query: '{ hello }' });
		expect(((await response.json()) as Body).data).toEqual({ hello: 'world' });
	});

	test('APQ registration works, then the hash alone hits', async () => {
		const query = '{ hello }';
		const sha256Hash = new Bun.CryptoHasher('sha256')
			.update(query)
			.digest('hex');
		const extensions = { persistedQuery: { version: 1, sha256Hash } };
		const miss = (await (await post(graxia, { extensions })).json()) as Body;
		expect(codes(miss)).toEqual(['PERSISTED_QUERY_NOT_FOUND']);
		const sent = (await (
			await post(graxia, { query, extensions })
		).json()) as Body;
		expect(sent.data).toEqual({ hello: 'world' });
		await Bun.sleep(10); // the registration runs in the background
		const hit = (await (await post(graxia, { extensions })).json()) as Body;
		expect(hit.data).toEqual({ hello: 'world' });
	});

	test('errors are still masked, in every environment', async () => {
		const { body } = await byId(graxia, 'boom');
		expect(body.errors?.[0]?.message).toBe('Unexpected error.');
	});

	test('onUnexpected logs to console.error by default', async () => {
		const spy = spyOn(console, 'error').mockImplementation(() => {});
		try {
			await byId(build(undefined, false), 'boom');
			expect(spy).toHaveBeenCalledTimes(1);
		} finally {
			spy.mockRestore();
		}
	});
});
