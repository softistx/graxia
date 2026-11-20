import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { useResponseCache } from '@envelop/response-cache';
import { type Booted, boot, calls } from './fixtures.test-util';
import { fromEnvelop } from './from-envelop';

let app: Booted;
beforeEach(() => calls.reset());
afterEach(() => app.stop());

const cached = (options: object = {}) =>
	boot([
		fromEnvelop([
			useResponseCache({
				session: () => null,
				includeExtensionMetadata: true,
				...options,
			}),
		]),
	]);

describe('@envelop/response-cache', () => {
	test('the second identical query is served from the cache', async () => {
		app = cached();
		await app.gql('{ hello }');
		const second = await app.gql('{ hello }');
		expect(second.json.data.hello).toBe('world');
		expect(calls.hello).toBe(1);
		expect(second.json.extensions.responseCache.hit).toBe(true);
	});

	test('a mutation invalidates the entities it returns', async () => {
		app = cached();
		await app.gql('{ user(id: "1") { id name } }');
		await app.gql('mutation { rename(id: "1", name: "Grace") { id name } }');
		const after = await app.gql('{ user(id: "1") { id name } }');
		expect(after.json.data.user.name).toBe('Grace');
		expect(calls.user).toBe(2);
	});

	test('sessions get their own entries', async () => {
		app = cached({
			session: (ctx: { request: Request }) =>
				ctx.request.headers.get('x-session'),
		});
		await app.gql('{ hello }', { headers: { 'x-session': 'a' } });
		await app.gql('{ hello }', { headers: { 'x-session': 'b' } });
		expect(calls.hello).toBe(2);
		await app.gql('{ hello }', { headers: { 'x-session': 'a' } });
		expect(calls.hello).toBe(2);
	});
});
