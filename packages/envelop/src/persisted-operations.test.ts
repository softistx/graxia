import { afterEach, describe, expect, test } from 'bun:test';
import { usePersistedOperations } from '@envelop/persisted-operations';
import { type Booted, boot } from './fixtures.test-util';
import { fromEnvelop } from './from-envelop';

let app: Booted;
afterEach(() => app.stop());

const store = { abc: '{ hello }' };
const withStore = (onlyPersisted: boolean) =>
	boot([
		fromEnvelop([
			usePersistedOperations({
				store: {
					get: (id: string) =>
						(store as Record<string, string>)[id] ?? undefined,
				},
				onlyPersisted,
				extractOperationId: (ctx: {
					params?: { extensions?: { id?: string } };
				}) => ctx.params?.extensions?.id,
			}),
		]),
	]);

describe('@envelop/persisted-operations', () => {
	test('a known id runs its stored document', async () => {
		app = withStore(true);
		const response = await fetch(app.url, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				accept: 'application/graphql-response+json',
			},
			body: JSON.stringify({
				query: '{ __typename }',
				extensions: { id: 'abc' },
			}),
		});
		const json: any = await response.json();
		expect(json.data?.hello).toBe('world');
	});

	test('onlyPersisted refuses a raw query', async () => {
		app = withStore(true);
		const answer = await app.gql('{ hello }');
		expect(answer.json.errors).toBeDefined();
		expect(answer.json.data?.hello).toBeUndefined();
	});
});

describe('@envelop/persisted-operations limits', () => {
	test('a request with an id and no query is refused by core before any hook (send a placeholder query, or use core trustedDocuments)', async () => {
		app = withStore(true);
		const response = await fetch(app.url, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ extensions: { id: 'abc' } }),
		});
		expect(response.status).toBe(400);
		expect(await response.text()).toContain('Must provide a query string');
	});
});
